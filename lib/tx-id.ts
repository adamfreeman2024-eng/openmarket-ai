/** Normalize 0.0.x@seconds.nanos or 0.0.x-seconds-nanos */
export function normalizeTxId(id: string): string {
  const t = id.trim();
  if (t.includes("@")) {
    const [account, rest] = t.split("@");
    const [sec, nano] = rest.split(".");
    return `${account}-${sec}-${nano}`;
  }
  return t;
}
