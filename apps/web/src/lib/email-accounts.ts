/**
 * Reads EMAIL_N_ADDRESS / EMAIL_N_PASSWORD pairs from env.
 * Works for any N starting at 1 until a gap is found.
 */
export interface EmailAccountConfig {
  address: string;
  password: string;
  imapHost: string;
  smtpHost: string;
}

export function getEmailAccountConfigs(): EmailAccountConfig[] {
  const accounts: EmailAccountConfig[] = [];
  const imapHost = process.env.IMAP_SERVER ?? "imap.gmail.com";
  const smtpHost = process.env.SMTP_SERVER ?? "smtp.gmail.com";

  let i = 1;
  while (true) {
    const address = process.env[`EMAIL_${i}_ADDRESS`];
    const password = process.env[`EMAIL_${i}_PASSWORD`];
    if (!address || !password) break;
    accounts.push({ address, password, imapHost, smtpHost });
    i++;
  }
  return accounts;
}
