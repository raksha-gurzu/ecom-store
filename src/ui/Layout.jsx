// The page shell every storefront route renders inside: header with search,
// category pills, the page body, and the footer.
//
// This produces the SAME markup and class names the old string template did, so
// public/store.css styles it without a single change.

function CategoryPills({ depts, active }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <a className={`pill ${active ? "" : "active"}`} href="/">
          All
        </a>
        {depts.map((d) => {
          const on = active && active.toLowerCase() === d.dept.toLowerCase();
          return (
            <a
              key={d.dept}
              className={`pill ${on ? "active" : ""}`}
              href={`/category/${encodeURIComponent(d.dept)}`}
            >
              {d.dept}
            </a>
          );
        })}
      </div>
    </div>
  );
}

function Header({ depts, active, q }) {
  return (
    <header className="hdr">
      <div className="hdr-top">
        <a className="logo" href="/">
          <span className="dot" />
          meesa
        </a>
        <span className="tagline">Nepal's marketplace for women's products</span>
        {/* Plain GET form, not a controlled input: search must keep working
            before the JavaScript bundle loads, and on a page where it never does. */}
        <form className="search" method="get" action="/">
          <span className="ico">⌕</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="Search products…"
            autoComplete="off"
            aria-label="Search"
          />
        </form>
        <nav className="hdr-right">
          <a href="/">Home</a>
          <a href="/api-info">API</a>
        </nav>
      </div>
      <CategoryPills depts={depts} active={active} />
    </header>
  );
}

function Footer() {
  return (
    <footer className="foot">
      <div className="foot-inner">
        <span>
          Test merchant store · data scraped from{" "}
          <a href="https://meesa.shop" target="_blank" rel="noopener noreferrer">
            meesa.shop
          </a>
        </span>
        <span>
          Machine API: <a href="/api-info">/api/catalog</a> (token-gated)
        </span>
      </div>
    </footer>
  );
}

export default function Layout({ depts = [], active = null, q = "", children }) {
  return (
    <>
      <Header depts={depts} active={active} q={q} />
      <main className="wrap">{children}</main>
      <Footer />
    </>
  );
}
