/**
 * Evidence files (Phase 3).
 *
 * Photos are shrunk in the browser before upload: the longest side is limited to
 * 1600 px and JPEG quality is lowered step by step until the photo is at most
 * 500 KB. A small 320 px thumbnail is uploaded next to it for previews.
 * PDFs are uploaded as they are (2 MB maximum).
 *
 * Files go to the private "evidence" bucket under uploads/<your user id>/.
 * Storage rules in the database allow uploading only into your own folder and
 * reading only files attached to complaints you are allowed to see. Files are
 * shown through short-lived signed links, never public links.
 */
import { supabase } from "./supabase";

export const PHOTO_TARGET_BYTES = 500 * 1024;
export const PHOTO_PICK_MAX_BYTES = 10 * 1024 * 1024;
export const PDF_MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 1600;
const THUMB_SIDE = 320;
const BUCKET = "evidence";

export type StoredFile = { path: string; thumb: string | null; name: string; size: number };

function client() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

async function loadImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toJpeg(img: HTMLImageElement, maxSide: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This browser cannot resize images."));
  ctx.fillStyle = "#ffffff"; // transparent PNG areas become white, not black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("The photo could not be converted."))), "image/jpeg", quality),
  );
}

/** Shrinks a photo to at most PHOTO_TARGET_BYTES and makes a thumbnail. */
export async function shrinkPhoto(file: File): Promise<{ photo: Blob; thumb: Blob }> {
  const img = await loadImage(file);
  let side = MAX_SIDE;
  let photo: Blob | null = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    const quality = Math.max(0.45, 0.85 - (attempt % 6) * 0.08);
    photo = await toJpeg(img, side, quality);
    if (photo.size <= PHOTO_TARGET_BYTES) break;
    if (attempt % 6 === 5) side = Math.round(side * 0.75); // still too big at lowest quality: make it smaller
  }
  if (!photo || photo.size > PHOTO_TARGET_BYTES) throw new Error("The photo could not be made small enough. Please choose another photo.");
  const thumb = await toJpeg(img, THUMB_SIDE, 0.7);
  return { photo, thumb };
}

function newPath(userId: string, ext: string) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `uploads/${userId}/${id}.${ext}`;
}

async function put(path: string, body: Blob, contentType: string) {
  const { error } = await client().storage.from(BUCKET).upload(path, body, { contentType, upsert: false, cacheControl: "3600" });
  if (error) throw new Error(`The file could not be uploaded: ${error.message}`);
}

/** Uploads one evidence file (shrinking photos first). Returns what the database needs to record. */
export async function uploadEvidence(userId: string, file: File): Promise<StoredFile> {
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (isPdf) {
    if (file.size > PDF_MAX_BYTES) throw new Error("PDF files can be at most 2 MB.");
    const path = newPath(userId, "pdf");
    await put(path, file, "application/pdf");
    return { path, thumb: null, name: file.name, size: file.size };
  }
  const { photo, thumb } = await shrinkPhoto(file);
  const path = newPath(userId, "jpg");
  const thumbPath = path.replace(/\.jpg$/, "-thumb.jpg");
  await put(path, photo, "image/jpeg");
  await put(thumbPath, thumb, "image/jpeg");
  const name = file.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg";
  return { path, thumb: thumbPath, name, size: photo.size };
}

/** A temporary link (1 hour) to a stored file the signed-in user is allowed to see. */
export async function signedUrl(path: string): Promise<string> {
  const { data, error } = await client().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) throw new Error(error?.message || "File not available.");
  return data.signedUrl;
}
