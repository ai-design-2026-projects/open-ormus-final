import { AsyncLocalStorage } from "node:async_hooks";

export const userIdStorage = new AsyncLocalStorage<string>();
