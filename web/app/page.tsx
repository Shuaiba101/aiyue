import Link from "next/link";

export default function HomePage() {
  return (
    <main className="site">
      <div className="siteBreath" aria-hidden="true">
        <div className="outerHalo" />
        <div className="glowCore" />
      </div>

      <header className="siteNav">
        <div className="siteBrand">i阅</div>
        <nav>
          <Link href="/read">内测入口</Link>
        </nav>
      </header>

      <section className="siteHero">
        <p className="siteEyebrow">ireading · 内测中</p>
        <h1>陪你读书</h1>
        <p className="siteLead">
          你读纸质书，书在你手里。
          <br />
          i阅 在文字里陪着——帮你记着，也越来越懂你。
        </p>
        <div className="siteActions">
          <Link className="sitePrimary" href="/read">
            进入 i阅
          </Link>
        </div>
        <p className="siteBetaNote">邀请制内测 · 有邀请码直接注册，或先申请资格</p>
      </section>

      <section className="siteScene">
        <p className="siteSectionLabel">一次陪读</p>
        <div className="siteDialogue">
          <p className="siteLine siteLineUser">
            第 3 章这里停了一下，有点说不出的感觉。
          </p>
          <p className="siteLine siteLineAi">
            我记着。你自己读的时候，它碰到你的哪一块了？
          </p>
        </div>
        <p className="siteScenePause">—— 三天后 ——</p>
        <div className="siteDialogue">
          <p className="siteLine siteLineAi">
            上次在《沉思录》那段你停了很久。书还在你手里，今晚接着读吗？
          </p>
        </div>
      </section>

      <section className="siteTrace">
        <p className="siteSectionLabel">心迹</p>
        <ul className="siteTraceList">
          <li>
            <span className="siteTraceMeta">今天 · 《沉思录》 · 触动</span>
            第 3 章这里停了一下，有点说不出的感觉
          </li>
          <li>
            <span className="siteTraceMeta">昨天 · 《沉思录》 · 问题</span>
            为什么要把死亡写得这么平静？
          </li>
          <li>
            <span className="siteTraceMeta">洞察</span>
            他在意的不是「读懂」，而是读的时候有人记得他停在哪里
          </li>
        </ul>
      </section>

      <section className="sitePrinciples">
        <ul>
          <li>不替你把书读完</li>
          <li>用提问推你想，不用结论压你</li>
          <li>记得是你这个人，不是把书架连成网</li>
        </ul>
      </section>

      <section className="siteBeta">
        <h2>内测邀请制</h2>
        <p>
          i阅 还在内测，功能和体验会持续打磨。
          欢迎先来试试——有触动、有疑问、有想聊的，发给它就行。
        </p>
        <Link className="sitePrimary" href="/read">
          申请内测 / 进入
        </Link>
      </section>

      <footer className="siteFooter">
        <span>© {new Date().getFullYear()} i阅 · ireading.top</span>
        <Link href="/read">进入应用</Link>
      </footer>
    </main>
  );
}
