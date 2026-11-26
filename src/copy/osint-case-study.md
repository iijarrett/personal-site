## Case study

### The problem

Most OSINT tool lists go stale, put safe and risky tools side by side, and say little about
how to work. I wanted a guide that starts from what you are allowed to do, keeps itself
current, and lets someone move from what they hold to what they can reach.

### Constraints

- **Ethics first.** Some tools are easy to misuse, so they are named and nothing more: the
  guide holds their details and cautions.
- **This site's rules.** A Content Security Policy with no exceptions, no third-party
  requests, and nothing fetched when a page opens.
- **One source of truth.** Every number and every link comes from the guide's data, so the
  page cannot drift from the guide.

### Decisions

1. **The guide is data.** Each tool is one entry in a YAML file and the pages are generated,
   so a fix is made once.
2. **A native map, not a graph library.** The pivot map is plain SVG and HTML. That adds no
   dependency and no CSP exception, and every node can be reached from the keyboard.
3. **Vendored data, read at build time.** The site holds copies of the guide's JSON and never
   fetches it. A refresh is a copy, a test run and a pull request, and the tests catch a pivot
   that points at nothing.
4. **Real HTML first.** Every row and panel is in the page before any script runs. With
   JavaScript off you still get the whole list.
5. **Gated tools are enforced, not promised.** The template reads a tool only through one
   function, and that function hands a gated tool's row its name, tier, link and one fixed
   line. A test fails if a gated tool appears in the map or carries any other field.
6. **One script entry.** The build forbids shared chunks, so the tabs, the map and the list
   are one entry that shares a single copy of its state. That state is the address bar, so a
   trail or a tool is a link you can send.
7. **Limits moved on purpose.** The size limits went up when the page gained real features,
   each time in a reviewed pull request with the reason written down.

### Results

- Works with JavaScript off, from the keyboard, in dark and light, and on a 400px phone.
- Every change passes type-check, lint, tests, the built-output rules and Lighthouse budgets
  before it can merge.
- Trails, tools and filters are shareable links, and a trail exports as Markdown.

### What I would do next

- Show each tool's link health from the guide's weekly check, next to its check date.
- Add worked examples for more starting points, such as a username or a photo.
- Label starter issues in the guide's repository so others can contribute.
