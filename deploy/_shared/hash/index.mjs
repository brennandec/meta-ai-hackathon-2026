// deploy/_shared/hash — HASH64 deterministic lineage per Bible §4.3b
// HASH64(moat||slug||point||promptHash||minute) → mulberry32 seed
// Only allowed PRNG is mulberry32 seeded from HASH64 output. Math.random forbidden.
export function hash64(str){
  // FNV-1a 64-bit (BigInt) — stable, byte-identical across devices
  let h = 14695981039346656037n;
  const prime = 1099511628211n;
  for(let i=0;i<str.length;i++){
    h ^= BigInt(str.charCodeAt(i));
    h = (h * prime) & 0xFFFFFFFFFFFFFFFFn;
  }
  // fold to 32-bit seed for mulberry32 (lower 32 bits)
  return Number(h & 0xFFFFFFFFn) >>> 0;
}
export function hash64ToSeed(moatId, slug, point, promptHash, minute, receiptId){
  const parts = [moatId, slug, point, promptHash, String(minute)];
  if (receiptId) parts.push(String(receiptId));
  return hash64(parts.join('|'));
}
export function mulberry32(a){
  return function(){
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
export function promptHashNormalize(prompt){
  return String(prompt||'').trim().toLowerCase().replace(/\s+/g,' ').slice(0,256);
}
export function quantizedMinute(d=Date.now()){
  return Math.floor(d/60000);
}
// Convenience: HASH64(moat||slug||point||promptHash||minute) → rng
export function rngFromHash(moatId, slug, point, prompt, minuteBucket){
  const ph = promptHashNormalize(prompt);
  const minute = minuteBucket ?? quantizedMinute();
  const seed = hash64ToSeed(moatId, slug, point, ph, minute);
  return { seed, rng: mulberry32(seed), ph, minute };
}
