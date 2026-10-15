export interface PublicFixture {
  name: string; bytes: Buffer; text: string;
  identity: { path:string; sha256:string; bytes:number; documentId:string; version:string; visibility:string; releasePhases:string[]; locators:string[] };
}
export function publicFixture(phase:'task1'|'task2'):Promise<PublicFixture[]>;
export function sha256(bytes:string|Uint8Array):string;
