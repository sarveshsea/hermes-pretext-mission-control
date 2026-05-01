declare module "@chenglou/pretext" {
  export function prepareWithSegments(text: string, font: string): unknown;
  export function layoutWithLines(
    prepared: unknown,
    width: number,
    lineHeight: number
  ): {
    lines: Array<{
      text: string;
      width?: number;
      x?: number;
      y?: number;
    }>;
  };
}
