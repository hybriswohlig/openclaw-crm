const MAX_SIDE = 1600;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Datei konnte nicht gelesen werden."));
    };
    reader.onerror = () => reject(new Error("Datei konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    img.src = url;
  });
}

export async function prepareReceiptDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    if (file.size > MAX_FILE_BYTES) {
      throw new Error(
        "Datei zu groß. Belege als PDF maximal 2 MB, Fotos werden automatisch verkleinert."
      );
    }
    return readAsDataUrl(file);
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Bild konnte nicht verarbeitet werden.");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    if (dataUrl.length * 0.75 > MAX_IMAGE_BYTES) {
      dataUrl = canvas.toDataURL("image/jpeg", 0.6);
    }
    return dataUrl;
  } catch (err) {
    if (err instanceof Error && err.message) throw err;
    throw new Error("Bild konnte nicht verarbeitet werden.");
  } finally {
    URL.revokeObjectURL(url);
  }
}
