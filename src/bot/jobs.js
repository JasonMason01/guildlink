const chains = new Map();

export function enqueue(key, task) {
  const previous = chains.get(key) ?? Promise.resolve();
  const run = previous.then(() => task());
  chains.set(
    key,
    run.then(
      () => {},
      () => {}
    )
  );
  return run;
}
