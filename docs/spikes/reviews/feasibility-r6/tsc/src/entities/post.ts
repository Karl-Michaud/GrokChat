export interface Post { readonly id: string; readonly version: number }
export const bump = (p: Post): Post => ({ ...p, version: p.version + 1 });
