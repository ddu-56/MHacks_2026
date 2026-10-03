const ts = () => new Date().toISOString().slice(11, 23);

export const log = {
  info: (msg: string) => console.log(`${ts()} ${msg}`),
  warn: (msg: string) => console.warn(`${ts()} WARN ${msg}`),
  error: (msg: string) => console.error(`${ts()} ERROR ${msg}`),
  call: (callId: bigint, msg: string) => console.log(`${ts()} [call ${callId}] ${msg}`),
};
