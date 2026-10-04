// The converged scenario of the cellfmax dry path, in its own Node process (see the comment above
// `only` in custom-cell-fmax-sky130-demo-dry-path.host.test.ts).
process.env.CELLFMAX_DRY_ONLY = 'converged';
await import('./custom-cell-fmax-sky130-demo-dry-path.host.test.ts');
