# Working on avgo

There is no local `aver`. Everything runs through the toolchain image:
`docker build --target dev -t avgo-toolchain .`, then
`docker run --rm -v "$PWD":/app -w /app avgo-toolchain check main.av --module-root .`
and the same with `verify . --module-root .`. Both exit non-zero on failure.

`aver check` treats a pure function with no `verify` block as an **error**, not
a warning, so every function you add needs one. Effectful functions are exempt
— that is why the serve loop has almost none and the rules have many.

Never read `HttpRequest.query`. It type-checks and then dies at runtime with
`record has no field 'query'` — the checker knows the field, the VM's record
arena does not. Constructing a request with `query` is fine; the value is just
dropped. This is why the player token travels in a header.

The pages, the stylesheet and the scripts are all read from disk **once at
startup** and held in the store, so editing any of them needs the server
restarted before the change is visible. The bare file name is the key: the
router matches `/static/<name>` against that map, which is also why no path
traversal is possible.

The pages live in `web/static/*.html` rather than in Aver string literals
because Aver strings are single-line and `{` starts an interpolation (`{{`
escapes it), which makes embedded HTML and JavaScript miserable. Keep them as
files.

The store is per-process and threaded through the serve loop's recursion.
Anything that would run a second instance — scaling, a restart during a game,
scale-to-zero on a free host — loses every game in progress. Don't add
concurrency or replicas without moving the store first.

Passing `check` and `verify` is not the same as working. The two worst bugs so
far — the `query` field and a CSS rule that made a button invisible on hover —
both passed everything and were only caught by running the container and
playing a game. Do that before calling something done.
