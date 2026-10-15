/**
 * WhatsApp retires an unpaired companion's adv secret and sends
 * `<notification type="companion_reg_refresh">`. Baileys 7.0.0-rc14 acks
 * that and keeps showing a QR built on the retired secret, so the phone
 * says the connection failed. This vendors the unmerged fix from
 * WhiskeySockets/Baileys#2765 until a release contains it.
 *
 * Idempotent. Run against the pnpm install root.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "/app";

function findFiles(dir, test, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (name === ".git") continue;
      findFiles(path, test, out);
    } else if (test(path)) {
      out.push(path);
    }
  }
  return out;
}

const sockets = findFiles(
  root,
  (p) => p.endsWith("/baileys/lib/Socket/socket.js"),
);
if (sockets.length === 0) {
  console.error("baileys socket.js not found under", root);
  process.exit(1);
}

const UTILS_ADD = `
import { randomBytes } from 'crypto';
import { getBinaryNodeChild } from '../WABinary/index.js';
`.replace(/^\n/, "");

const UTILS_BODY = `
export const makePairingQRRenderer = (refs, render) => {
    let index = 0;
    let current;
    return {
        next() {
            const ref = refs[index];
            if (ref === undefined) {
                return false;
            }
            index += 1;
            current = ref;
            render(ref);
            return true;
        },
        refresh() {
            if (current === undefined) {
                return false;
            }
            render(current);
            return true;
        }
    };
};
const COMPANION_REG_REFRESH_CHILDREN = ['companion_reg_refresh', 'pair-device-rotate-qr'];
export const handleCompanionRegRefresh = (node, { creds, emitCredsUpdate, refreshQR, logger }) => {
    if (!COMPANION_REG_REFRESH_CHILDREN.some(tag => getBinaryNodeChild(node, tag))) {
        logger.warn({ node }, 'companion_reg_refresh carries neither expected child; ignoring');
        return 'ignored_malformed';
    }
    if (creds.me) {
        logger.debug({ id: node.attrs.id }, 'companion_reg_refresh on a registered session; keeping the adv secret');
        return 'ignored_registered';
    }
    creds.advSecretKey = randomBytes(32).toString('base64');
    emitCredsUpdate({ advSecretKey: creds.advSecretKey });
    logger.info({ id: node.attrs.id }, 'rotated the adv secret the server asked to retire; re-rendering the pairing QR');
    refreshQR();
    return 'rotated';
};
`;

const QR_BLOCK_OLD = `        const advB64 = creds.advSecretKey;
        let qrMs = qrTimeout || 60000; // time to let a QR live
        const genPairQR = () => {
            if (!ws.isOpen) {
                return;
            }
            const refNode = refNodes.shift();
            if (!refNode) {
                void end(new Boom('QR refs attempts ended', { statusCode: DisconnectReason.timedOut }));
                return;
            }
            const ref = refNode.content.toString('utf-8');
            const qr = buildPairingQRData(ref, noiseKeyB64, identityKeyB64, advB64, browser);
            ev.emit('connection.update', { qr });
            qrTimer = setTimeout(genPairQR, qrMs);
            qrMs = qrTimeout || 20000; // shorter subsequent qrs
        };
        genPairQR();
    });
    // device paired for the first time`;

const QR_BLOCK_NEW = `        const renderer = makePairingQRRenderer(refNodes.map(refNode => refNode.content.toString('utf-8')),
        ref => ev.emit('connection.update', {
            qr: buildPairingQRData(ref, noiseKeyB64, identityKeyB64, creds.advSecretKey, browser)
        }));
        refreshPairingQR = () => void renderer.refresh();
        let qrMs = qrTimeout || 60000; // time to let a QR live
        const genPairQR = () => {
            if (!ws.isOpen) {
                return;
            }
            if (!renderer.next()) {
                void end(new Boom('QR refs attempts ended', { statusCode: DisconnectReason.timedOut }));
                return;
            }
            qrTimer = setTimeout(genPairQR, qrMs);
            qrMs = qrTimeout || 20000; // shorter subsequent qrs
        };
        genPairQR();
    });
    ws.on('CB:notification,type:companion_reg_refresh', (node) => {
        handleCompanionRegRefresh(node, {
            creds,
            emitCredsUpdate: update => ev.emit('creds.update', update),
            refreshQR: () => refreshPairingQR?.(),
            logger
        });
    });
    // device paired for the first time`;

for (const socketPath of sockets) {
  const lib = socketPath.slice(0, socketPath.lastIndexOf("/Socket/socket.js"));
  const utilsPath = join(lib, "Utils/companion-reg-client-utils.js");
  const recvPath = join(lib, "Socket/messages-recv.js");
  let socket = readFileSync(socketPath, "utf8");
  if (socket.includes("CB:notification,type:companion_reg_refresh")) {
    console.log("already patched", socketPath);
    continue;
  }
  if (!socket.includes("getNextPreKeysNode, makeEventBuffer")) {
    throw new Error("socket import anchor missing: " + socketPath);
  }
  socket = socket.replace(
    "getNextPreKeysNode, makeEventBuffer",
    "getNextPreKeysNode, handleCompanionRegRefresh, makeEventBuffer, makePairingQRRenderer",
  );
  if (!socket.includes("let refreshPairingQR;")) {
    socket = socket.replace(
      "    // QR gen\n",
      "    let refreshPairingQR;\n    // QR gen\n",
    );
  }
  if (!socket.includes(QR_BLOCK_OLD)) {
    throw new Error("QR block anchor missing: " + socketPath);
  }
  socket = socket.replace(QR_BLOCK_OLD, QR_BLOCK_NEW);
  writeFileSync(socketPath, socket);

  let utils = readFileSync(utilsPath, "utf8");
  if (!utils.includes("export const handleCompanionRegRefresh")) {
    if (!utils.includes("import { randomBytes } from 'crypto';")) {
      utils = UTILS_ADD + utils;
    }
    const mapLine = "//# sourceMappingURL=companion-reg-client-utils.js.map";
    if (!utils.includes(mapLine)) {
      throw new Error("companion utils map anchor missing: " + utilsPath);
    }
    utils = utils.replace(mapLine, UTILS_BODY + mapLine);
    writeFileSync(utilsPath, utils);
  }

  let recv = readFileSync(recvPath, "utf8");
  const recvOld = `            case 'link_code_companion_reg':
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));`;
  const recvNew = `            case 'link_code_companion_reg':
                const linkCodeCompanionReg = getBinaryNodeChild(node, 'link_code_companion_reg');
                if (!getBinaryNodeChildBuffer(linkCodeCompanionReg, 'primary_identity_pub')) { break; }
                const ref = toRequiredBuffer(getBinaryNodeChildBuffer(linkCodeCompanionReg, 'link_code_pairing_ref'));`;
  if (!recv.includes("primary_identity_pub')) { break; }")) {
    if (!recv.includes(recvOld)) {
      throw new Error("link_code anchor missing: " + recvPath);
    }
    recv = recv.replace(recvOld, recvNew);
    writeFileSync(recvPath, recv);
  }
  console.log("patched", socketPath);
}
