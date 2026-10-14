export function nativePgObserver(home: { readonly home:string }, evidence:string, repoRoot:string):Promise<{
  capture(runIds:readonly string[]):Promise<void>;
  dispose():Promise<void>;
}>;
