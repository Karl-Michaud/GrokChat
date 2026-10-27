/** Wrangler bundles `*.txt` as a Text module: the file's contents as a string. */
declare module "*.txt" {
  const text: string;
  export default text;
}
