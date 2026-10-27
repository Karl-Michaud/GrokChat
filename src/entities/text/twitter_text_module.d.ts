/** The part of twitter-text 3.1.0 that GrokChat uses (the package ships no types). */
declare module "twitter-text" {
  interface ParsedTweet {
    readonly weightedLength: number;
    readonly valid: boolean;
    readonly permillage: number;
    readonly validRangeStart: number;
    readonly validRangeEnd: number;
    readonly displayRangeStart: number;
    readonly displayRangeEnd: number;
  }

  interface ParseConfig {
    readonly version: number;
    readonly maxWeightedTweetLength: number;
    readonly scale: number;
    readonly defaultWeight: number;
    readonly transformedURLLength: number;
  }

  interface UrlWithIndices {
    readonly url: string;
    readonly indices: readonly [number, number];
  }

  interface TwitterText {
    parseTweet(text: string, config?: ParseConfig): ParsedTweet;
    extractUrls(text: string): string[];
    extractUrlsWithIndices(text: string): UrlWithIndices[];
    readonly configs: { readonly version2: ParseConfig; readonly version3: ParseConfig };
  }

  const twitterText: TwitterText;
  export default twitterText;
}
