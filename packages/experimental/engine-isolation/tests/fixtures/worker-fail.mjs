// Keyless failing engine worker for the process-out driver spec: prints a
// non-JSON line and exits 1, exercising the ENGINE_SPAWN_FAILED path.

process.stdout.write('this is not the worker result line\n')
process.stdout.write('', () => process.exit(1))
