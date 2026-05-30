import Link from "next/link";

export default function HomePage() {
  return (
    <main className="site">
      <div className="siteHalo" />
      <header className="siteNav">
        <div className="siteBrand">i阅</div>
        <nav>
          <Link href="/read">开始阅读</Link>
        </nav>
      </header>

      <section className="siteHero">
        <p className="siteEyebrow">AI 阅读陪伴 · 有记忆</p>
        <h1>陪你读书</h1>
        <p className="siteLead">
          你读纸质书，书在你手里。i阅 在文字里陪着——有触动、有疑问、随便什么想聊的，发给它就行。
          它帮你记着，也在和你聊的过程中，越来越懂你。
        </p>
        <div className="siteActions">
          <Link className="sitePrimary" href="/read">
            开始阅读
          </Link>
        </div>
      </section>

      <section className="siteFeatures">
        <article>
          <h2>陪着读</h2>
          <p>不抢书、不代读、不 lecturing。你翻你的纸页，有想聊的随时说。</p>
        </article>
        <article>
          <h2>帮你记着</h2>
          <p>读过的书、说过的话、你在意的问题——都会留下来，下次接着聊。</p>
        </article>
        <article>
          <h2>越来越懂你</h2>
          <p>每一次对话都在加深理解。i阅 会慢慢学会怎么陪「你这个人」读书。</p>
        </article>
      </section>

      <footer className="siteFooter">
        <span>© {new Date().getFullYear()} i阅 · ireading.top</span>
        <Link href="/read">进入应用</Link>
      </footer>
    </main>
  );
}
