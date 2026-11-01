import type { HomeSnapshot } from "./homeSnapshot";

const KEY = "home";

let database: Promise<IDBDatabase> | null = null;

async function store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("tasks-web", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return (await database).transaction("snapshots", mode).objectStore("snapshots");
}

function settle<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The visitor's home as this browser last saved it, or undefined on a first visit. */
export async function loadHome(): Promise<HomeSnapshot | undefined> {
  return settle((await store("readonly")).get(KEY) as IDBRequest<HomeSnapshot | undefined>);
}

export async function saveHome(snapshot: HomeSnapshot): Promise<void> {
  await settle((await store("readwrite")).put(snapshot, KEY));
}
