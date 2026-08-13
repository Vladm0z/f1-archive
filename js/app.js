const app = document.getElementById("app");
const state = {
  data: null
};

init();

async function init() {
  try {
    state.data = await loadData();
    window.addEventListener("hashchange", route);
    route();
  } catch (error) {
    console.error(error);
    app.innerHTML = `
      <div class="empty">
        Could not load data. Check the browser console and make sure all JSON files are valid.
      </div>
    `;
  }
}

async function loadData() {
  const [languages, drivers, races, articles] = await Promise.all([
    fetch("data/languages.json").then(checkResponse),
    fetch("data/drivers.json").then(checkResponse),
    fetch("data/races.json").then(checkResponse),
    fetch("data/articles.json").then(checkResponse)
  ]);

  return {
    languages,
    drivers: sortDrivers(drivers),
    races,
    articles,
    driversById: makeById(drivers),
    racesById: makeById(races)
  };
}

async function checkResponse(response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${response.url}`);
  }
  return response.json();
}

function makeById(items) {
  return Object.fromEntries(items.map(item => [item.id, item]));
}

function sortDrivers(drivers) {
  return [...drivers].sort((a, b) => {
    return (a.sort_name || a.name).localeCompare(b.sort_name || b.name);
  });
}

function route() {
  const data = state.data;
  const { path, params } = parseHash();

  let page;

  if (path === "") {
    page = renderHome(data);
  } else if (path === "drivers") {
    page = renderDrivers(data);
  } else if (path.startsWith("driver/")) {
    const driverId = path.split("/")[1] || "";
    page = renderDriverPage(data, driverId, params);
  } else if (path === "races") {
    page = renderRaces(data);
  } else if (path.startsWith("race/")) {
    const raceId = path.split("/")[1] || "";
    page = renderRacePage(data, raceId, params);
    } else if (path === "articles") {
    page = renderArticles(data, params);
  } else if (path.startsWith("article/")) {
    const articleId = path.split("/")[1] || "";
    page = renderArticlePage(data, articleId);
  } else {
    page = {
      html: `<div class="empty">Page not found.</div>`
    };
  }

  app.innerHTML = page.html;

  if (page.afterRender) {
    page.afterRender();
  }

  window.scrollTo({
    top: 0,
    behavior: "auto"
  });
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, "");
  const normalized = raw.startsWith("/") ? raw : `/${raw}`;
  const [pathPart, queryPart = ""] = normalized.split("?");
  const path = pathPart.replace(/^\/+|\/+$/g, "");
  const params = new URLSearchParams(queryPart);

  return {
    path,
    params
  };
}

function getSelectedLanguages(params) {
  return (params.get("lang") || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
}

function getSort(params) {
  return params.get("sort") === "desc" ? "desc" : "asc";
}

function buildHash(path, params) {
  const queryString = params.toString();
  return `#/${path}${queryString ? `?${queryString}` : ""}`;
}

function updateParams(params, changes) {
  const next = new URLSearchParams(params);

  for (const [key, value] of Object.entries(changes)) {
    if (
      value === null ||
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      next.delete(key);
    } else if (Array.isArray(value)) {
      next.set(key, value.join(","));
    } else {
      next.set(key, value);
    }
  }

  return next;
}

function normalizeString(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

function languageLabel(data, code) {
  const language = data.languages.find(item => item.code === code);
  return language ? language.label : code.toUpperCase();
}

function driverName(data, driverId) {
  return data.driversById[driverId]?.name || "—";
}

function raceLabel(data, raceId) {
  const race = data.racesById[raceId];
  if (!race) return raceId;
  return `${race.name} ${race.season || ""}`.trim();
}

function emptyHtml(message) {
  return `<div class="empty">${esc(message)}</div>`;
}

function filterByLanguages(articles, selectedLanguages) {
  if (!selectedLanguages.length) {
    return articles;
  }

  return articles.filter(article => selectedLanguages.includes(article.language));
}

function sortArticles(articles, sortDirection) {
  return [...articles].sort((a, b) => {
    const aDate = a.published_sort || "";
    const bDate = b.published_sort || "";

    if (sortDirection === "desc") {
      return bDate.localeCompare(aDate);
    }

    return aDate.localeCompare(bDate);
  });
}

function getEntityArticles(data, { driverId, raceId }) {
  return data.articles.filter(article => {
    const matchesDriver = driverId
      ? (article.driver_ids || []).includes(driverId)
      : true;

    const matchesRace = raceId
      ? (article.race_ids || []).includes(raceId)
      : true;

    return matchesDriver && matchesRace;
  });
}

function articleCardHtml(data, article) {
  const driverNames = (article.driver_ids || [])
    .map(id => data.driversById[id]?.name)
    .filter(Boolean);

  const raceNames = (article.race_ids || [])
    .map(id => raceLabel(data, id))
    .filter(Boolean);

  const links = [];

  if (getArticleContentFiles(article).length) {
    links.push(`
      <a href="#/article/${esc(article.id)}">Open article</a>
    `);
  }

  if (article.url) {
    links.push(`
      <a href="${esc(article.url)}" target="_blank" rel="noopener">Read</a>
    `);
  }

  if (article.archive_url) {
    links.push(`
      <a href="${esc(article.archive_url)}" target="_blank" rel="noopener">Archive</a>
    `);
  }

  return `
    <article class="card">
      <div class="card-top">
        <span class="badge">${esc(article.article_type || "article")}</span>
        <span class="badge badge-soft">${esc(languageLabel(data, article.language))}</span>
        <span class="muted">${esc(article.published_display || article.published_sort || "")}</span>
      </div>

      <h3>${esc(article.title || article.id)}</h3>

      ${
        article.source_publication
          ? `<p class="muted">
              ${esc(article.source_publication)}
              ${article.pages ? ` • pp. ${esc(article.pages)}` : ""}
             </p>`
          : ""
      }

      ${
        driverNames.length
          ? `<p><strong>Drivers:</strong> ${esc(driverNames.join(", "))}</p>`
          : ""
      }

      ${
        raceNames.length
          ? `<p><strong>Races:</strong> ${esc(raceNames.join(", "))}</p>`
          : ""
      }

      ${
        article.citation
          ? `<p class="muted">${esc(article.citation)}</p>`
          : ""
      }

      ${
        links.length
          ? `<div class="links">${links.join("")}</div>`
          : ""
      }
    </article>
  `;
}

function languageFilterHtml(data, availableLanguages, selectedLanguages) {
  if (!availableLanguages.length) {
    return "";
  }

  const checkboxes = availableLanguages.map(code => {
    const checked = selectedLanguages.includes(code) ? "checked" : "";

    return `
      <label class="check">
        <input
          type="checkbox"
          class="language-filter"
          value="${esc(code)}"
          ${checked}
        >
        ${esc(languageLabel(data, code))}
      </label>
    `;
  }).join("");

  return `
    <div class="filters">
      <span class="filters-label">Language:</span>
      <div class="check-group">
        ${checkboxes}
      </div>
    </div>
  `;
}

function sortFilterHtml(currentSort) {
  return `
    <div class="filters">
      <span class="filters-label">Sort:</span>
      <select class="sort-filter">
        <option value="asc" ${currentSort === "asc" ? "selected" : ""}>
          Oldest first
        </option>
        <option value="desc" ${currentSort === "desc" ? "selected" : ""}>
          Newest first
        </option>
      </select>
    </div>
  `;
}

function attachEntityFilters(pathKey, params) {
  const languageBoxes = [...document.querySelectorAll(".language-filter")];
  const sortSelect = document.querySelector(".sort-filter");

  function applyChanges(changes) {
    const nextParams = updateParams(params, changes);
    window.location.hash = buildHash(pathKey, nextParams);
  }

  languageBoxes.forEach(box => {
    box.addEventListener("change", () => {
      const checked = languageBoxes
        .filter(item => item.checked)
        .map(item => item.value);

      applyChanges({
        lang: checked
      });
    });
  });

  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      applyChanges({
        sort: sortSelect.value === "asc" ? null : sortSelect.value
      });
    });
  }
}

function renderHome(data) {
  const recentArticles = [...data.articles]
    .sort((a, b) => {
      return String(b.added_at || "").localeCompare(String(a.added_at || ""));
    })
    .slice(0, 6);

  const topDrivers = data.drivers.slice(0, 8);

  const topRaces = [...data.races]
    .sort((a, b) => {
      return (b.season || 0) - (a.season || 0) || (a.round || 999) - (b.round || 999);
    })
    .slice(0, 8);

  const html = `
    <section class="hero">
      <h1>F1 interview & print archive</h1>
      <p>
        Browse interviews, race reports, profiles and other printed sources
        by driver, race, language and date.
      </p>

      <div class="hero-actions">
        <a class="button" href="#/drivers">Browse drivers</a>
        <a class="button secondary" href="#/races">Browse races</a>
        <a class="button secondary" href="#/articles">All articles</a>
      </div>
    </section>

    <section>
      <div class="section-head">
        <h2>Recently added articles</h2>
        <a href="#/articles">View all articles</a>
      </div>

      <div class="stack">
        ${
          recentArticles.length
            ? recentArticles.map(article => articleCardHtml(data, article)).join("")
            : emptyHtml("No articles yet.")
        }
      </div>
    </section>

    <section class="two-columns home-panels">
      <div class="card">
        <h2>Drivers</h2>
        <div class="list">
          ${
            topDrivers.length
              ? topDrivers.map(driver => `
                  <a class="list-item" href="#/driver/${esc(driver.id)}">
                    <span>${esc(driver.name)}</span>
                    <span class="muted">${esc(driver.nationality || "")}</span>
                  </a>
                `).join("")
              : emptyHtml("No drivers yet.")
          }
        </div>
      </div>

      <div class="card">
        <h2>Races</h2>
        <div class="list">
          ${
            topRaces.length
              ? topRaces.map(race => `
                  <a class="list-item" href="#/race/${esc(race.id)}">
                    <span>${esc(race.name)} ${race.season || ""}</span>
                    <span class="muted">${esc(race.country || "")}</span>
                  </a>
                `).join("")
              : emptyHtml("No races yet.")
          }
        </div>
      </div>
    </section>
  `;

  return {
    html
  };
}

function renderDrivers(data) {
  const html = `
    <section class="page-head">
      <h1>Drivers</h1>
      <p class="muted">
        Search by name, nationality or alias.
      </p>
    </section>

    <input
      id="driver-search"
      class="input"
      type="search"
      placeholder="Search drivers..."
      autocomplete="off"
    >

    <div id="driver-list" class="driver-grid">
      ${driverCardsHtml(data, data.drivers)}
    </div>
  `;

  function afterRender() {
    const input = document.getElementById("driver-search");
    const list = document.getElementById("driver-list");

    input.addEventListener("input", () => {
      const filtered = filterDrivers(data.drivers, input.value);
      list.innerHTML = driverCardsHtml(data, filtered);
    });
  }

  return {
    html,
    afterRender
  };
}

function filterDrivers(drivers, query) {
  const q = normalizeString(query);

  if (!q) {
    return drivers;
  }

  return drivers.filter(driver => {
    const parts = [
      driver.name,
      driver.sort_name,
      driver.first_name,
      driver.last_name,
      driver.nationality,
      ...(driver.aliases || [])
    ];

    return normalizeString(parts.join(" ")).includes(q);
  }).sort((a, b) => {
    return (a.sort_name || a.name).localeCompare(b.sort_name || b.name);
  });
}

function driverCardsHtml(data, drivers) {
  if (!drivers.length) {
    return emptyHtml("No drivers found.");
  }

  return drivers.map(driver => `
    <a class="card driver-card" href="#/driver/${esc(driver.id)}">
      <h3>${esc(driver.name)}</h3>
      <p class="muted">
        ${esc(driver.nationality || "")}
        ${driver.active_years ? ` • ${esc(driver.active_years)}` : ""}
      </p>
    </a>
  `).join("");
}

function renderRaces(data) {
  if (!data.races.length) {
    return {
      html: `
        <section class="page-head">
          <h1>Races</h1>
        </section>
        ${emptyHtml("No races yet.")}
      `
    };
  }

  const seasons = [...new Set(data.races.map(race => race.season))]
    .sort((a, b) => b - a);

  const seasonBlocks = seasons.map(season => {
    const seasonRaces = data.races
      .filter(race => race.season === season)
      .sort((a, b) => (a.round || 999) - (b.round || 999));

    const raceItems = seasonRaces.map(race => `
      <a class="list-item" href="#/race/${esc(race.id)}">
        <span>${esc(race.name)} ${race.season || ""}</span>
        <span class="muted">${esc(race.date || "")}</span>
      </a>
    `).join("");

    return `
      <section class="season-block">
        <h2 class="season-title">${esc(season)}</h2>
        <div class="list">
          ${raceItems}
        </div>
      </section>
    `;
  }).join("");

  const html = `
    <section class="page-head">
      <h1>Races</h1>
      <p class="muted">
        Races grouped by season.
      </p>
    </section>

    ${seasonBlocks}
  `;

  return {
    html
  };
}

function renderDriverPage(data, driverId, params) {
  const driver = data.driversById[driverId];

  if (!driver) {
    return {
      html: emptyHtml("Driver not found.")
    };
  }

  const entityArticles = getEntityArticles(data, { driverId });
  const selectedLanguages = getSelectedLanguages(params);
  const sort = getSort(params);

  const availableLanguages = [...new Set(
    entityArticles
      .map(article => article.language)
      .filter(Boolean)
  )].sort();

  const filteredArticles = sortArticles(
    filterByLanguages(entityArticles, selectedLanguages),
    sort
  );

  const articlesHtml = filteredArticles.length
    ? filteredArticles.map(article => articleCardHtml(data, article)).join("")
    : emptyHtml("No articles match these filters.");

  const sidebar = `
    <aside class="sidebar">
      <div class="card">
        <h2>Driver info</h2>

        <dl>
          <dt>Nationality</dt>
          <dd>${esc(driver.nationality || "—")}</dd>

          <dt>Born</dt>
          <dd>${esc(driver.date_of_birth || "—")}</dd>

          ${
            driver.date_of_death
              ? `
                <dt>Died</dt>
                <dd>${esc(driver.date_of_death)}</dd>
              `
              : ""
          }

          <dt>Active years</dt>
          <dd>${esc(driver.active_years || "—")}</dd>

          <dt>Teams</dt>
          <dd>${esc((driver.teams || []).join(", ") || "—")}</dd>

          <dt>Championships</dt>
          <dd>${driver.championships ?? 0}</dd>

          <dt>Podiums</dt>
          <dd>${driver.podiums ?? 0}</dd>
          <dt>Wins</dt>
          <dd>${driver.wins ?? "—"}</dd>

          <dt>Pole positions</dt>
          <dd>${driver.pole_positions ?? "—"}</dd>
        </dl>

        ${
          driver.wikipedia_url
            ? `
              <p>
                <a href="${esc(driver.wikipedia_url)}" target="_blank" rel="noopener">
                  Wikipedia
                </a>
              </p>
            `
            : ""
        }
      </div>

      <div class="card">
        <h2>Articles</h2>
        <p class="muted">
          ${filteredArticles.length} shown / ${entityArticles.length} total
        </p>
      </div>
    </aside>
  `;

  const html = `
    <section class="page-head">
      <h1>${esc(driver.name)}</h1>
      <p class="muted">
        ${esc(driver.nationality || "")}
        ${driver.active_years ? ` • ${esc(driver.active_years)}` : ""}
      </p>
    </section>

    <div class="layout">
      <div class="main-col">
        <div class="toolbar">
          ${languageFilterHtml(data, availableLanguages, selectedLanguages)}
          ${sortFilterHtml(sort)}
        </div>

        <div class="stack">
          ${articlesHtml}
        </div>
      </div>

      ${sidebar}
    </div>
  `;

  return {
    html,
    afterRender: () => attachEntityFilters(`driver/${driver.id}`, params)
  };
}

function renderRacePage(data, raceId, params) {
  const race = data.racesById[raceId];

  if (!race) {
    return {
      html: emptyHtml("Race not found.")
    };
  }

  const entityArticles = getEntityArticles(data, { raceId });
  const selectedLanguages = getSelectedLanguages(params);
  const sort = getSort(params);

  const availableLanguages = [...new Set(
    entityArticles
      .map(article => article.language)
      .filter(Boolean)
  )].sort();

  const filteredArticles = sortArticles(
    filterByLanguages(entityArticles, selectedLanguages),
    sort
  );

  const articlesHtml = filteredArticles.length
    ? filteredArticles.map(article => articleCardHtml(data, article)).join("")
    : emptyHtml("No articles match these filters.");

  const resultsHtml = race.results && race.results.length
    ? `
      <div class="card">
        <h2>Results</h2>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Pos</th>
                <th>Driver</th>
                <th>Team</th>
                <th>Time/Status</th>
              </tr>
            </thead>

            <tbody>
              ${
                race.results.map(result => `
                  <tr>
                    <td>${esc(result.position)}</td>
                    <td>${esc(driverName(data, result.driver_id))}</td>
                    <td>${esc(result.team || "")}</td>
                    <td>${esc(result.time_or_status || "")}</td>
                  </tr>
                `).join("")
              }
            </tbody>
          </table>
        </div>
      </div>
    `
    : `
      <div class="card">
        <h2>Results</h2>
        <div class="empty">
          No results stored yet.
        </div>
      </div>
    `;

  const sidebar = `
    <aside class="sidebar">
      <div class="card">
        <h2>Race info</h2>

        <dl>
          <dt>Date</dt>
          <dd>${esc(race.date || "—")}</dd>

          <dt>Circuit</dt>
          <dd>${esc(race.circuit || "—")}</dd>

          <dt>Locality</dt>
          <dd>${esc(race.locality || "—")}</dd>

          <dt>Country</dt>
          <dd>${esc(race.country || "—")}</dd>

          <dt>Winner</dt>
          <dd>${esc(driverName(data, race.winner_driver_id))}</dd>

          <dt>Winning team</dt>
          <dd>${esc(race.winning_team || "—")}</dd>

          <dt>Pole position</dt>
          <dd>${esc(driverName(data, race.pole_driver_id))}</dd>

          <dt>Fastest lap</dt>
          <dd>${esc(driverName(data, race.fastest_lap_driver_id))}</dd>
        </dl>

        ${
          race.wikipedia_url
            ? `
              <p>
                <a href="${esc(race.wikipedia_url)}" target="_blank" rel="noopener">
                  Wikipedia
                </a>
              </p>
            `
            : ""
        }
      </div>

      ${resultsHtml}
    </aside>
  `;

  const html = `
    <section class="page-head">
      <h1>${esc(race.season || "")} ${esc(race.name)}</h1>
      <p class="muted">
        ${esc(race.circuit || "")}
        ${race.country ? ` • ${esc(race.country)}` : ""}
      </p>
    </section>

    <div class="layout">
      <div class="main-col">
        <div class="toolbar">
          ${languageFilterHtml(data, availableLanguages, selectedLanguages)}
          ${sortFilterHtml(sort)}
        </div>

        <div class="stack">
          ${articlesHtml}
        </div>
      </div>

      ${sidebar}
    </div>
  `;

  return {
    html,
    afterRender: () => attachEntityFilters(`race/${race.id}`, params)
  };
}

function renderArticles(data, params) {
  const allArticles = data.articles;
  const selectedLanguages = getSelectedLanguages(params);
  const sort = getSort(params);

  const availableLanguages = [...new Set(
    allArticles
      .map(article => article.language)
      .filter(Boolean)
  )].sort();

  const filteredArticles = sortArticles(
    filterByLanguages(allArticles, selectedLanguages),
    sort
  );

  const articlesHtml = filteredArticles.length
    ? filteredArticles.map(article => articleCardHtml(data, article)).join("")
    : emptyHtml("No articles match these filters.");

  const html = `
    <section class="page-head">
      <h1>All articles</h1>
      <p class="muted">
        All stored interviews, reports and printed sources.
      </p>
    </section>

    <div class="toolbar">
      ${languageFilterHtml(data, availableLanguages, selectedLanguages)}
      ${sortFilterHtml(sort)}
    </div>

    <div class="stack">
      ${articlesHtml}
    </div>
  `;

  return {
    html,
    afterRender: () => attachEntityFilters("articles", params)
  };
}

function getArticleContentFiles(article) {
  if (Array.isArray(article.content_files) && article.content_files.length) {
    return article.content_files;
  }

  if (article.content) {
    return [article.content];
  }

  return [];
}

async function checkTextResponse(response) {
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${response.url}`);
  }

  return response.text();
}

function renderMarkdown(markdown) {
  if (window.marked) {
    const html = marked.parse(markdown);

    if (window.DOMPurify) {
      return DOMPurify.sanitize(html);
    }

    return html;
  }

  return `<pre class="article-text">${esc(markdown)}</pre>`;
}

async function loadArticleContentFile(article, file) {
  const container = document.getElementById("article-content");

  if (!container) {
    return;
  }

  if (!file) {
    container.innerHTML = emptyHtml("No content file selected.");
    return;
  }

  container.innerHTML = `<div class="empty">Loading content…</div>`;

  try {
    if (file.type === "text") {
      const text = await fetch(file.src).then(checkTextResponse);

      container.innerHTML = `
        <pre class="article-text">${esc(text)}</pre>
      `;
    } else if (file.type === "markdown") {
      const markdown = await fetch(file.src).then(checkTextResponse);

      container.innerHTML = renderMarkdown(markdown);
    } else if (file.type === "html") {
      const html = await fetch(file.src).then(checkTextResponse);

      container.innerHTML = window.DOMPurify
        ? DOMPurify.sanitize(html)
        : html;
    } else if (file.type === "pdf") {
      container.innerHTML = `
        <div class="pdf-wrap">
          <iframe
            src="${esc(file.src)}"
            title="${esc(article.title || article.id)}"
          ></iframe>

          <p>
            <a href="${esc(file.src)}" target="_blank" rel="noopener">
              Open PDF in new tab
            </a>
          </p>
        </div>
      `;
    } else if (file.type === "scan") {
      const pages = file.pages || [];

      if (!pages.length) {
        throw new Error("Scan content has no pages.");
      }

      container.innerHTML = `
        <div class="scan-pages">
          ${
            pages.map((src, index) => `
              <figure class="scan-page">
                <img
                  loading="lazy"
                  src="${esc(src)}"
                  alt="Page ${index + 1} of ${esc(article.title || article.id)}"
                >
                <figcaption>Page ${index + 1}</figcaption>
              </figure>
            `).join("")
          }
        </div>
      `;
    } else if (file.type === "inline_text") {
      container.innerHTML = `
        <pre class="article-text">${esc(file.body || "")}</pre>
      `;
    } else if (file.type === "inline_markdown") {
      container.innerHTML = renderMarkdown(file.body || "");
    } else {
      container.innerHTML = emptyHtml(`Unsupported content type: ${file.type}`);
    }
  } catch (error) {
    console.error(error);

    container.innerHTML = emptyHtml(
      "Could not load article content. Check the file path and JSON data."
    );
  }
}

function renderArticlePage(data, articleId) {
  const article = data.articles.find(item => item.id === articleId);

  if (!article) {
    return {
      html: emptyHtml("Article not found.")
    };
  }

  const files = getArticleContentFiles(article);

  const driverLinks = (article.driver_ids || []).map(id => {
    const driver = data.driversById[id];

    if (!driver) {
      return esc(id);
    }

    return `
      <a href="#/driver/${esc(driver.id)}">
        ${esc(driver.name)}
      </a>
    `;
  });

  const raceLinks = (article.race_ids || []).map(id => {
    const race = data.racesById[id];

    if (!race) {
      return esc(id);
    }

    return `
      <a href="#/race/${esc(race.id)}">
        ${esc(race.name)} ${race.season || ""}
      </a>
    `;
  });

  const fileSelectorHtml = files.length > 1
    ? `
      <div class="toolbar">
        <div class="filters">
          <span class="filters-label">View:</span>

          <select id="article-file-select" class="sort-filter">
            ${
              files.map((file, index) => `
                <option value="${index}">
                  ${esc(file.label || file.type || `File ${index + 1}`)}
                </option>
              `).join("")
            }
          </select>
        </div>
      </div>
    `
    : "";

  const html = `
    <section class="page-head">
      <p>
        <a href="#/articles">← All articles</a>
      </p>

      <h1>${esc(article.title || article.id)}</h1>

      <p class="muted">
        ${esc(article.article_type || "article")}
        ${article.language ? ` • ${esc(languageLabel(data, article.language))}` : ""}
        ${article.published_display || article.published_sort
          ? ` • ${esc(article.published_display || article.published_sort)}`
          : ""}
      </p>
    </section>

    <div class="layout">
      <div class="main-col">
        ${fileSelectorHtml}

        <div class="card">
          <div id="article-content" class="article-content">
            ${
              files.length
                ? `<div class="empty">Loading content…</div>`
                : emptyHtml("No full content stored for this article yet.")
            }
          </div>
        </div>
      </div>

      <aside class="sidebar">
        <div class="card">
          <h2>Article info</h2>

          <dl>
            <dt>Publication</dt>
            <dd>${esc(article.source_publication || "—")}</dd>

            <dt>Source kind</dt>
            <dd>${esc(article.source_kind || "—")}</dd>

            <dt>Article type</dt>
            <dd>${esc(article.article_type || "—")}</dd>

            <dt>Language</dt>
            <dd>
              ${article.language ? esc(languageLabel(data, article.language)) : "—"}
            </dd>

            <dt>Published</dt>
            <dd>${esc(article.published_display || article.published_sort || "—")}</dd>

            <dt>Pages</dt>
            <dd>${esc(article.pages || "—")}</dd>

            <dt>Drivers</dt>
            <dd>${driverLinks.length ? driverLinks.join(", ") : "—"}</dd>

            <dt>Races</dt>
            <dd>${raceLinks.length ? raceLinks.join(", ") : "—"}</dd>
          </dl>

          ${
            article.citation
              ? `<p class="muted">${esc(article.citation)}</p>`
              : ""
          }

          ${
            article.url
              ? `
                <p>
                  <a href="${esc(article.url)}" target="_blank" rel="noopener">
                    Original URL
                  </a>
                </p>
              `
              : ""
          }

          ${
            article.archive_url
              ? `
                <p>
                  <a href="${esc(article.archive_url)}" target="_blank" rel="noopener">
                    Archive URL
                  </a>
                </p>
              `
              : ""
          }
        </div>
      </aside>
    </div>
  `;

  function afterRender() {
    const select = document.getElementById("article-file-select");

    async function loadSelectedFile() {
      const index = select ? Number(select.value) : 0;
      const file = files[index];

      await loadArticleContentFile(article, file);
    }

    if (select) {
      select.addEventListener("change", loadSelectedFile);
    }

    if (files.length) {
      loadSelectedFile();
    }
  }

  return {
    html,
    afterRender
  };
}
