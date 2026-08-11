const DB_NAME = "gastos-voz-offline";
const STORE = "cola";

export type ItemCola = {
  id?: number;
  tipo: "audio" | "texto" | "foto";
  texto?: string;
  blob?: Blob;
  nombreArchivo?: string;
  timestamp: number;
};

function abrirDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function encolarCaptura(item: Omit<ItemCola, "id" | "timestamp">) {
  const db = await abrirDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add({ ...item, timestamp: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function obtenerCola(): Promise<ItemCola[]> {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as ItemCola[]);
    req.onerror = () => reject(req.error);
  });
}

export async function borrarDeCola(id: number) {
  const db = await abrirDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function itemAFormData(item: ItemCola): FormData {
  const formData = new FormData();
  if (item.tipo === "texto" && item.texto) formData.append("texto", item.texto);
  if (item.tipo === "audio" && item.blob) formData.append("audio", item.blob, item.nombreArchivo ?? "audio.webm");
  if (item.tipo === "foto" && item.blob) formData.append("foto", item.blob, item.nombreArchivo ?? "foto.jpg");
  return formData;
}
