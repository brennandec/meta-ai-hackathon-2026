import { hash64, mulberry32 } from "./index.mjs";
let counter = 0;
export function seededUid(prefix) {
  counter += 1;
  const rng = mulberry32(hash64(`${prefix}|${counter}`));
  const disperse = Math.floor(rng() * 1679616).toString(36).padStart(4, "0");
  return `${prefix}-${counter.toString(36)}${disperse}`;
}
export function bindSuffix(stemUid, tail) {
  const at = stemUid.lastIndexOf('-');
  const prefix = stemUid.slice(0, at);
  const counter36 = stemUid.slice(at + 1, -4);
  const counter = parseInt(counter36, 36);
  const rng = mulberry32(hash64(`${prefix}|${counter}|${tail}`));
  const disperse = Math.floor(rng() * 1679616).toString(36).padStart(4, "0");
  return `${prefix}-${counter36}${disperse}-${tail}`;
}
