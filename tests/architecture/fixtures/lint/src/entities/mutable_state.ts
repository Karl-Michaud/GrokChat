export let counter = 0;

let hidden = 0;

export function bump(): number {
  hidden += 1;
  counter = hidden;
  return counter;
}
