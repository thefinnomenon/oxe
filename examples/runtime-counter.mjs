import {
  batch,
  createCell,
  createDerived,
  createReaction,
  createRoot,
} from '../packages/runtime/dist/index.js';

const output = [];

const app = createRoot(() => {
  const count = createCell(0, { name: 'count' });
  const doubled = createDerived([count], () => count.read() * 2, { name: 'doubled' });

  createReaction(
    [count, doubled],
    () => output.push(`count=${count.read()} doubled=${doubled.read()}`),
    { name: 'counter output' },
  );

  return {
    incrementTwice: () =>
      batch(() => {
        count.write(count.read() + 1);
        count.write(count.read() + 1);
      }),
  };
});

app.value.incrementTwice();
app.dispose();

console.log(output.join('\n'));
