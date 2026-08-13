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
	const [languages, drivers, races, articles, teamsRaw] = await Promise.all([
		fetch("data/languages.json").then(checkResponse),
		fetch("data/drivers.json").then(checkResponse),
		fetch("data/races.json").then(checkResponse),
		fetch("data/articles.json").then(checkResponse),
		fetchOptionalJson("data/teams.json")
	]);

	const teams = Array.isArray(teamsRaw) ? teamsRaw : [];

	return {
		languages,
		drivers: sortDrivers(drivers),
		races,
		articles,
		teams: sortTeams(teams),
		driversById: makeById(drivers),
		racesById: makeById(races),
		teamsById: makeById(teams),
		teamsByName: makeTeamsByName(teams)
	};
}

function sortTeams(teams) {
	return [...teams].sort((a, b) => {
		return (a.name || "").localeCompare(b.name || "");
	});
}

function normalizeTeamKey(value) {
	let text = String(value ?? "");

	text = text.replace(/\s*\(.*?\)\s*/g, " ");
	text = normalizeString(text);
	text = text.replace(/[^\w\s-]/g, "");
	text = text.replace(/\s+/g, " ").trim();

	return text;
}

function makeTeamsByName(teams) {
	const map = {};

	teams.forEach((team) => {
		const key = normalizeTeamKey(team.name);

		if (key) {
			map[key] = team.id;
		}
	});

	return map;
}

async function checkResponse(response) {
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} for ${response.url}`);
	}

	return response.json();
}

async function fetchOptionalJson(path) {
	try {
		const response = await fetch(path);

		if (!response.ok) {
			return [];
		}

		return await response.json();
	} catch (error) {
		console.warn(`Optional file not loaded: ${path}`);
		return [];
	}
}

function makeById(items) {
	return Object.fromEntries(items.map((item) => [item.id, item]));
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
	} else if (path === "teams") {
		page = renderTeams(data);
	} else if (path.startsWith("team/")) {
		const teamId = path.split("/")[1] || "";
		page = renderTeamPage(data, teamId, params);
	} else if (path === "articles") {
		page = renderArticles(data, params);
	} else if (path.startsWith("article/")) {
		const articleId = path.split("/")[1] || "";
		page = renderArticlePage(data, articleId);
	} else {
		page = {
			html: `
				<div class="empty">
					Page not found.
				</div>
			`
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
		.map((value) => value.trim())
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
	return String(value ?? "").replace(/[&<>"']/g, (character) => {
		const entities = {
			"&": "&amp;",
			"<": "&lt;",
			">": "&gt;",
			'"': "&quot;",
			"'": "&#39;"
		};

		return entities[character];
	});
}

function languageLabel(data, code) {
	const language = data.languages.find((item) => item.code === code);

	if (language) {
		return language.label;
	}

	return code ? String(code).toUpperCase() : "—";
}

function driverName(data, driverId) {
	return data.driversById[driverId]?.name || "—";
}

function raceLabel(data, raceId) {
	const race = data.racesById[raceId];

	if (!race) {
		return raceId;
	}

	return `${race.name} ${race.season || ""}`.trim();
}

function emptyHtml(message) {
	return `
		<div class="empty">
			${esc(message)}
		</div>
	`;
}

function filterByLanguages(articles, selectedLanguages) {
	if (!selectedLanguages.length) {
		return articles;
	}

	return articles.filter((article) => selectedLanguages.includes(article.language));
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

function getEntityArticles(data, { driverId, raceId, teamId }) {
	return data.articles.filter((article) => {
		const matchesDriver = driverId
			? (article.driver_ids || []).includes(driverId)
			: true;

		const matchesRace = raceId
			? (article.race_ids || []).includes(raceId)
			: true;

		const matchesTeam = teamId
			? (article.team_ids || []).includes(teamId)
			: true;

		return matchesDriver && matchesRace && matchesTeam;
	});
}

function articleCardHtml(data, article) {
	const driverNames = (article.driver_ids || [])
		.map((id) => data.driversById[id]?.name)
		.filter(Boolean);

	const raceNames = (article.race_ids || [])
		.map((id) => raceLabel(data, id))
		.filter(Boolean);

	const teamNames = (article.team_ids || [])
		.map((id) => data.teamsById[id]?.name)
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
				<span class="badge">
					${esc(article.article_type || "article")}
				</span>

				<span class="badge badge-soft">
					${esc(languageLabel(data, article.language))}
				</span>

				<span class="muted">
					${esc(article.published_display || article.published_sort || "")}
				</span>
			</div>

			<h3>${esc(article.title || article.id)}</h3>

			${
				article.source_publication
					? `
						<p class="muted">
							${esc(article.source_publication)}
							${article.pages ? ` • pp. ${esc(article.pages)}` : ""}
						</p>
					`
					: ""
			}

			${
				driverNames.length
					? `
						<p>
							<strong>Drivers:</strong>
							${esc(driverNames.join(", "))}
						</p>
					`
					: ""
			}

			${
				raceNames.length
					? `
						<p>
							<strong>Races:</strong>
							${esc(raceNames.join(", "))}
						</p>
					`
					: ""
			}

			${
				teamNames.length
					? `
						<p>
							<strong>Teams:</strong>
							${esc(teamNames.join(", "))}
						</p>`
					: ""
			}

			${
				article.citation
					? `
						<p class="muted">
							${esc(article.citation)}
						</p>
					`
					: ""
			}

			${
				links.length
					? `
						<div class="links">
							${links.join("")}
						</div>
					`
					: ""
			}
		</article>
	`;
}

function languageFilterHtml(data, availableLanguages, selectedLanguages) {
	if (!availableLanguages.length) {
		return "";
	}

	const checkboxes = availableLanguages
		.map((code) => {
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
		})
		.join("");

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

	languageBoxes.forEach((box) => {
		box.addEventListener("change", () => {
			const checked = languageBoxes
				.filter((item) => item.checked)
				.map((item) => item.value);

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

const wikiSummaryCache = {};

function wikiTitleFromUrl(url) {
	if (!url) return null;

	const match = String(url).trim().match(/\/wiki\/([^?#]+)/);
	if (!match) return null;

	const title = match[1].trim();
	return title || null;
}

async function fetchWikiSummary(title) {
	if (!title) return null;
	if (wikiSummaryCache[title]) return wikiSummaryCache[title];

	const storageKey = "wiki-summary:" + title;

	// localStorage cache (7 days)
	try {
		const stored = localStorage.getItem(storageKey);

		if (stored) {
			const parsed = JSON.parse(stored);

			if (parsed && parsed.timestamp && Date.now() - parsed.timestamp < 7 * 24 * 60 * 60 * 1000) {
				wikiSummaryCache[title] = parsed.data;
				return parsed.data;
			}
		}
	} catch (error) {
		// localStorage unavailable (private mode etc.) – ignore
	}

	try {
		const res = await fetch(
			"https://en.wikipedia.org/api/rest_v1/page/summary/" + title
		);

		if (!res.ok) return null;

		const data = await res.json();

		if (!data || data.type === "disambiguation") return null;

		const summary = {
			extract: data.extract || "",
			image: data.thumbnail ? data.thumbnail.source : ""
		};

		wikiSummaryCache[title] = summary;

		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify({ timestamp: Date.now(), data: summary })
			);
		} catch (error) {
			// ignore
		}

		return summary;
	} catch (error) {
		return null;
	}
}

async function loadWikiIntro(wikipediaUrl, altText) {
	const container = document.getElementById("wiki-intro");
	if (!container || !wikipediaUrl) return;

	const title = wikiTitleFromUrl(wikipediaUrl);
	if (!title) return;

	const summary = await fetchWikiSummary(title);
	if (!summary || (!summary.extract && !summary.image)) return;

	container.innerHTML = `
		<div class="wiki-intro card">
			${
				summary.image
					? `<img class="wiki-intro-image" src="${esc(summary.image)}" alt="${esc(altText || "")}">`
					: ""
			}
			<div class="wiki-intro-text">
				${summary.extract ? `<p>${esc(summary.extract)}</p>` : ""}
				<p class="muted wiki-intro-source">
					From
					<a href="${esc(String(wikipediaUrl).trim())}" target="_blank" rel="noopener">
						Wikipedia
					</a>
					(CC BY-SA)
				</p>
			</div>
		</div>
	`;
}

function randomSample(items, count) {
	const arr = [...items];

	for (let i = arr.length - 1; i > 0; i -= 1) {
		const j = Math.floor(Math.random() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}

	return arr.slice(0, count);
}

function renderHome(data) {
	const recentArticles = [...data.articles]
		.sort((a, b) => {
			return String(b.added_at || "").localeCompare(String(a.added_at || ""));
		})
		.slice(0, 6);

	const featuredDrivers = randomSample(data.drivers, 4);

	const today = new Date().toISOString().slice(0, 10);

	// Prefer races that already happened.
	// If there are no dated past races, fall back to all races.
	const pastRaces = data.races.filter((race) => {
		return race.date && race.date <= today;
	});

	const latestRaces = (pastRaces.length ? pastRaces : data.races)
		.sort((a, b) => {
			return (
				String(b.date || "").localeCompare(String(a.date || "")) ||
				(b.season || 0) - (a.season || 0) ||
				(b.round || 0) - (a.round || 0)
			);
		})
		.slice(0, 4);

	const html = `
		<section class="hero">
			<h1>F1 interview & print archive</h1>

			<p>
				Browse interviews, race reports, profiles and other printed sources
				by driver, race, team, language and date.
			</p>

			<div class="hero-actions">
				<a class="button" href="#/drivers">Browse drivers</a>
				<a class="button secondary" href="#/teams">Browse teams</a>
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
						? recentArticles
								.map((article) => articleCardHtml(data, article))
								.join("")
						: emptyHtml("No articles yet.")
				}
			</div>
		</section>

		<section class="two-columns home-panels">
			<div class="card">
				<h2>Featured drivers</h2>

				<div class="list">
					${
						featuredDrivers.length
							? featuredDrivers
									.map((driver) => `
										<a class="list-item" href="#/driver/${esc(driver.id)}">
											<span>${esc(driver.name)}</span>
											<span class="muted">${esc(driver.nationality || "")}</span>
										</a>
									`)
									.join("")
							: emptyHtml("No drivers yet.")
					}
				</div>
			</div>

			<div class="card">
				<h2>Latest races</h2>

				<div class="list">
					${
						latestRaces.length
							? latestRaces
									.map((race) => `
										<a class="list-item" href="#/race/${esc(race.id)}">
											<span>${esc(race.name)} ${race.season || ""}</span>
											<span class="muted">
												${esc(race.country || "")}
												${race.date ? ` • ${esc(race.date)}` : ""}
											</span>
										</a>
									`)
									.join("")
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

	return drivers
		.filter((driver) => {
			const parts = [
				driver.name,
				driver.sort_name,
				driver.first_name,
				driver.last_name,
				driver.nationality,
				...(driver.aliases || [])
			].filter(Boolean);

			return normalizeString(parts.join(" ")).includes(q);
		})
		.sort((a, b) => {
			return (a.sort_name || a.name).localeCompare(b.sort_name || b.name);
		});
}

function driverCardsHtml(data, drivers) {
	if (!drivers.length) {
		return emptyHtml("No drivers found.");
	}

	return drivers
		.map((driver) => `
			<a class="card driver-card" href="#/driver/${esc(driver.id)}">
				<h3>${esc(driver.name)}</h3>

				<p class="muted">
					${esc(driver.nationality || "")}
					${driver.active_years ? ` • ${esc(driver.active_years)}` : ""}
				</p>
			</a>
		`)
		.join("");
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

	// Group races by decade
	const decades = {};
	data.races.forEach(race => {
		const decade = Math.floor(race.season / 10) * 10;
		const decadeLabel = `${decade}s`;
		if (!decades[decade]) decades[decade] = { label: decadeLabel, years: {} };
		if (!decades[decade].years[race.season]) {
			decades[decade].years[race.season] = [];
		}
		decades[decade].years[race.season].push(race);
	});

	// Sort decades descending (2020s, 2010s, etc.)
	const sortedDecades = Object.keys(decades).sort((a, b) => b - a);
	let decadesHtml = "";

	sortedDecades.forEach(decadeKey => {
		const decade = decades[decadeKey];
		const sortedYears = Object.keys(decade.years).sort((a, b) => b - a);
		
		let yearsHtml = "";
		sortedYears.forEach((year, yearIndex) => {
			const races = decade.years[year].sort((a, b) => a.round - b.round);
			const racesHtml = races.map(race => `
				<li class="race-item">
					<a href="#/race/${esc(race.id)}">
						<span class="race-name">
							<span class="race-round">R${esc(String(race.round).padStart(2, '0'))}</span>
							${esc(race.name)}
						</span>
						<span class="muted race-meta">${esc(race.country || "")} • ${esc(race.date || "")}</span>
					</a>
				</li>
			`).join("");
			
			// Open the most recent year of the most recent decade by default
			const isOpen = (yearIndex === 0 && decadeKey === sortedDecades[0]);
			
			yearsHtml += `
				<details class="year-group" ${isOpen ? 'open' : ''}>
					<summary class="year-summary">
						<span>${esc(year)} Season</span>
						<span class="muted" style="font-size:0.85rem; margin-right:1rem;">${races.length} races</span>
					</summary>
					<ul class="races-list">
						${racesHtml}
					</ul>
				</details>
			`;
		});

		const isDecadeOpen = decadeKey === sortedDecades[0];
		
		decadesHtml += `
			<details class="decade-group" ${isDecadeOpen ? 'open' : ''}>
				<summary class="decade-summary">
					<span>${esc(decade.label)}</span>
					<span style="font-size:0.85rem; font-weight:normal; opacity:0.8;">${Object.keys(decade.years).length} seasons</span>
				</summary>
				<div class="years-container">
					${yearsHtml}
				</div>
			</details>
		`;
	});

	const html = `
		<section class="page-head">
			<h1>Races</h1>
			<p class="muted">
				Races grouped by decade and season.
			</p>
		</section>

		<div class="races-accordion">
			${decadesHtml}
		</div>
	`;

	return { html };
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
			.map((article) => article.language)
			.filter(Boolean)
	)].sort();

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles.map((article) => articleCardHtml(data, article)).join("")
		: emptyHtml("No articles match these filters.");

	const driverTeamLinks = (driver.teams || [])
		.filter(Boolean)
		.map((teamName) => teamLinkHtml(data, teamName));

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
					<dd>${driverTeamLinks.length ? driverTeamLinks.join(", ") : "—"}</dd>

					<dt>Championships</dt>
					<dd>${driver.championships ?? 0}</dd>

					<dt>Wins</dt>
					<dd>${driver.wins ?? 0}</dd>

					<dt>Podiums</dt>
					<dd>${driver.podiums ?? 0}</dd>

					<dt>Pole positions</dt>
					<dd>${driver.pole_positions ?? 0}</dd>

					<dt>Fastest laps</dt>
					<dd>${driver.fastest_laps ?? 0}</dd>
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
				<div id="wiki-intro"></div>
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
		afterRender: () => {
			attachEntityFilters(`driver/${driver.id}`, params);
			loadWikiIntro(driver.wikipedia_url, driver.name);
		}
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
			.map((article) => article.language)
			.filter(Boolean)
	)].sort();

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles.map((article) => articleCardHtml(data, article)).join("")
		: emptyHtml("No articles match these filters.");

	const resultsHtml = raceTabsHtml(data, race);

	const sidebar = `
		<aside class="sidebar">
			<div class="card">
				<h2>Race info</h2>

				<dl>
					<dt>Date</dt>
					<dd>${esc(race.date || "—")}</dd>

					<dt>Circuit</dt>
					<dd>${esc(race.circuit || "—")}</dd>

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
		afterRender: () => {
			attachEntityFilters(`race/${race.id}`, params);
			attachRaceTabs();
		}
	};
}

function renderArticles(data, params) {
	const allArticles = data.articles;
	const selectedLanguages = getSelectedLanguages(params);
	const sort = getSort(params);

	const availableLanguages = [...new Set(
		allArticles
			.map((article) => article.language)
			.filter(Boolean)
	)].sort();

	const filteredArticles = sortArticles(
		filterByLanguages(allArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles.map((article) => articleCardHtml(data, article)).join("")
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

	return `
		<pre class="article-text">${esc(markdown)}</pre>
	`;
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

	container.innerHTML = `
		<div class="empty">
			Loading content…
		</div>
	`;

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
						pages
							.map((src, index) => `
								<figure class="scan-page">
									<img
										loading="lazy"
										src="${esc(src)}"
										alt="Page ${index + 1} of ${esc(article.title || article.id)}"
									>
									<figcaption>Page ${index + 1}</figcaption>
								</figure>
							`)
							.join("")
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
	const article = data.articles.find((item) => item.id === articleId);

	if (!article) {
		return {
			html: emptyHtml("Article not found.")
		};
	}

	const files = getArticleContentFiles(article);

	const driverLinks = (article.driver_ids || [])
		.map((id) => {
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
		
	const teamLinks = (article.team_ids || [])
		.map((id) => {
			const team = data.teamsById[id];

			if (!team) {
				return esc(id);
			}

			return `
				<a href="#/team/${esc(team.id)}">
					${esc(team.name)}
				</a>
			`;
		});

	const raceLinks = (article.race_ids || [])
		.map((id) => {
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
							files
								.map((file, index) => `
									<option value="${index}">
										${esc(file.label || file.type || `File ${index + 1}`)}
									</option>
								`)
								.join("")
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
				${
					article.published_display || article.published_sort
						? ` • ${esc(article.published_display || article.published_sort)}`
						: ""
				}
			</p>
		</section>

		<div class="layout">
			<div class="main-col">
				${fileSelectorHtml}

				<div class="card">
					<div id="article-content" class="article-content">
						${
							files.length
								? `
									<div class="empty">
										Loading content…
									</div>
								`
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
						
						<dt>Teams</dt>
						<dd>${teamLinks.length ? teamLinks.join(", ") : "—"}</dd>
					</dl>

					${
						article.citation
							? `
								<p class="muted">
									${esc(article.citation)}
								</p>
							`
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

function getStartingGridRows(race) {
	const rows = [];

	if (Array.isArray(race.starting_grid) && race.starting_grid.length) {
		rows.push(...race.starting_grid);
	} else if (Array.isArray(race.results) && race.results.length) {
		for (const result of race.results) {
			const grid = parseInt(result.grid, 10);

			if (!Number.isNaN(grid) && grid >= 0) {
				rows.push({
					grid: grid,
					driver_id: result.driver_id,
					team: result.team || ""
				});
			}
		}
	}

	return rows.sort((a, b) => {
		const aGrid = Number(a.grid);
		const bGrid = Number(b.grid);

		const aSort = aGrid === 0 ? 9999 : aGrid;
		const bSort = bGrid === 0 ? 9999 : bGrid;

		return aSort - bSort;
	});
}

function positionDeltaHtml(result) {
	const pos = parseInt(result.position, 10);
	const grid = parseInt(result.grid, 10);

	// Only compare if the driver has a real finishing position
	// and a real starting grid position.
	if (Number.isNaN(pos) || pos <= 0 || Number.isNaN(grid) || grid <= 0) {
		return `
			<span class="delta delta-none">—</span>
		`;
	}

	const gained = grid - pos;

	if (gained > 0) {
		return `
			<span class="delta delta-up" title="Gained ${gained} place(s)">
				▲ ${gained}
			</span>
		`;
	}

	if (gained < 0) {
		return `
			<span class="delta delta-down" title="Lost ${Math.abs(gained)} place(s)">
				▼ ${Math.abs(gained)}
			</span>
		`;
	}

	return `
		<span class="delta delta-same" title="Finished where they started">
			0
		</span>
	`;
}

function raceResultsTableHtml(data, race) {
	if (!Array.isArray(race.results) || !race.results.length) {
		return emptyHtml("No results stored yet.");
	}

	const rows = [...race.results]
		.sort((a, b) => {
			const aPos = parseInt(a.position, 10);
			const bPos = parseInt(b.position, 10);

			const aSort = Number.isNaN(aPos) ? 9999 : aPos;
			const bSort = Number.isNaN(bPos) ? 9999 : bPos;

			return aSort - bSort;
		})
		.map((result) => {
			const driver = data.driversById[result.driver_id];

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(result.driver_name || result.driver_id || "—");

			const posNumber = parseInt(result.position, 10);

			const posDisplay = !Number.isNaN(posNumber) && posNumber > 0
				? String(posNumber)
				: (result.positionText || "—");

			return `
				<tr>
					<td>${esc(posDisplay)}</td>
					<td>${positionDeltaHtml(result)}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, result.team)}</td>
					<td>${esc(result.time_or_status || "")}</td>
				</tr>
			`;
		})
		.join("");

	return `
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Pos</th>
						<th title="Change compared to starting grid">Δ</th>
						<th>Driver</th>
						<th>Team</th>
						<th>Time/Status</th>
					</tr>
				</thead>

				<tbody>
					${rows}
				</tbody>
			</table>
		</div>
	`;
}

function raceQualifyingTableHtml(data, race) {
	if (!Array.isArray(race.qualifying) || !race.qualifying.length) {
		return emptyHtml("No qualifying data stored yet.");
	}

	const rows = [...race.qualifying]
		.sort((a, b) => {
			const aPos = parseInt(a.position, 10);
			const bPos = parseInt(b.position, 10);

			const aSort = Number.isNaN(aPos) ? 9999 : aPos;
			const bSort = Number.isNaN(bPos) ? 9999 : bPos;

			return aSort - bSort;
		})
		.map((q) => {
			const driver = data.driversById[q.driver_id];

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(q.driver_id || "—");

			return `
				<tr>
					<td>${esc(q.position || "—")}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, q.team)}</td>
					<td>${esc(q.q1 || "—")}</td>
					<td>${esc(q.q2 || "—")}</td>
					<td>${esc(q.q3 || "—")}</td>
				</tr>
			`;
		})
		.join("");

	return `
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Pos</th>
						<th>Driver</th>
						<th>Team</th>
						<th>Q1</th>
						<th>Q2</th>
						<th>Q3</th>
					</tr>
				</thead>

				<tbody>
					${rows}
				</tbody>
			</table>
		</div>
	`;
}

function raceStartingGridTableHtml(data, race) {
	const gridRows = getStartingGridRows(race);

	if (!gridRows.length) {
		return emptyHtml("No starting grid stored yet.");
	}

	const rows = gridRows
		.map((row) => {
			const driver = data.driversById[row.driver_id];

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(row.driver_id || "—");

			const gridValue = Number(row.grid);

			const gridDisplay = Number.isNaN(gridValue)
				? "—"
				: gridValue === 0
					? "PL"
					: esc(gridValue);

			return `
				<tr>
					<td>${gridDisplay}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, row.team)}</td>
				</tr>
			`;
		})
		.join("");

	return `
		<div class="table-wrap">
			<table>
				<thead>
					<tr>
						<th>Grid</th>
						<th>Driver</th>
						<th>Team</th>
					</tr>
				</thead>

				<tbody>
					${rows}
				</tbody>
			</table>
		</div>
	`;
}

function raceTabsHtml(data, race) {
	const hasResults = Array.isArray(race.results) && race.results.length > 0;
	const hasQualifying = Array.isArray(race.qualifying) && race.qualifying.length > 0;
	const hasGrid = getStartingGridRows(race).length > 0;

	if (!hasResults && !hasQualifying && !hasGrid) {
		return `
			<div class="card">
				<h2>Race data</h2>

				<div class="empty">
					No results stored yet.
				</div>
			</div>
		`;
	}

	return `
		<div class="card race-tabs-card">
			<div class="tabs">
				<button
					type="button"
					class="tab-button active"
					data-race-tab="results"
				>
					Results
				</button>

				<button
					type="button"
					class="tab-button"
					data-race-tab="qualifying"
					${hasQualifying ? "" : "disabled"}
				>
					Qualifying
				</button>

				<button
					type="button"
					class="tab-button"
					data-race-tab="grid"
					${hasGrid ? "" : "disabled"}
				>
					Starting grid
				</button>
			</div>

			<div class="tab-panel" data-race-tab-panel="results">
				${raceResultsTableHtml(data, race)}
			</div>

			<div class="tab-panel hidden" data-race-tab-panel="qualifying">
				${
					hasQualifying
						? raceQualifyingTableHtml(data, race)
						: emptyHtml("No qualifying data stored yet.")
				}
			</div>

			<div class="tab-panel hidden" data-race-tab-panel="grid">
				${
					hasGrid
						? raceStartingGridTableHtml(data, race)
						: emptyHtml("No starting grid stored yet.")
				}
			</div>
		</div>
	`;
}

function attachRaceTabs() {
	const buttons = document.querySelectorAll(".race-tabs-card [data-race-tab]");

	buttons.forEach((button) => {
		button.addEventListener("click", () => {
			const card = button.closest(".race-tabs-card");

			if (!card) {
				return;
			}

			const target = button.dataset.raceTab;

			card.querySelectorAll("[data-race-tab]").forEach((tabButton) => {
				tabButton.classList.toggle("active", tabButton === button);
			});

			card.querySelectorAll("[data-race-tab-panel]").forEach((panel) => {
				panel.classList.toggle("hidden", panel.dataset.raceTabPanel !== target);
			});
		});
	});
}

function findTeamIdByName(data, teamName) {
	if (!teamName || !data.teamsByName) {
		return null;
	}

	const norm = normalizeTeamKey(teamName);

	if (!norm || norm === "—") {
		return null;
	}

	// Exact match
	if (data.teamsByName[norm]) {
		return data.teamsByName[norm];
	}

	// Try parts before hyphen:
	// "Kurtis Kraft-Offenhauser" -> "Kurtis Kraft"
	const parts = norm
		.split(/[-–—/]/)
		.map((part) => part.trim())
		.filter(Boolean);

	for (const part of parts) {
		if (data.teamsByName[part]) {
			return data.teamsByName[part];
		}
	}

	// Longest known team name contained inside the given team name
	let bestId = null;
	let bestLength = 0;

	for (const [name, id] of Object.entries(data.teamsByName)) {
		if (name.length >= 3 && norm.includes(name) && name.length > bestLength) {
			bestLength = name.length;
			bestId = id;
		}
	}

	return bestId;
}

function teamLinkHtml(data, teamName) {
	if (!teamName) {
		return "—";
	}

	const teamId = findTeamIdByName(data, teamName);

	if (!teamId) {
		return esc(teamName);
	}

	return `
		<a href="#/team/${esc(teamId)}">
			${esc(teamName)}
		</a>
	`;
}

function filterTeams(teams, query) {
	const q = normalizeString(query);

	if (!q) {
		return teams;
	}

	return teams
		.filter((team) => {
			const parts = [
				team.name,
				team.nationality
			].filter(Boolean);

			return normalizeString(parts.join(" ")).includes(q);
		})
		.sort((a, b) => {
			return (a.name || "").localeCompare(b.name || "");
		});
}

function teamCardsHtml(data, teams) {
	if (!teams.length) {
		return emptyHtml("No teams found.");
	}

	return teams
		.map((team) => `
			<a class="card driver-card" href="#/team/${esc(team.id)}">
				<h3>${esc(team.name)}</h3>

				<p class="muted">
					${esc(team.nationality || "")}
					${team.active_years ? ` • ${esc(team.active_years)}` : ""}
				</p>

				<p class="muted">
					${team.wins ?? 0} wins • ${team.pole_positions ?? 0} poles
				</p>
			</a>
		`)
		.join("");
}

function renderTeams(data) {
	const html = `
		<section class="page-head">
			<h1>Teams</h1>

			<p class="muted">
				Search by name or nationality.
			</p>
		</section>

		<input
			id="team-search"
			class="input"
			type="search"
			placeholder="Search teams..."
			autocomplete="off"
		>

		<div id="team-list" class="driver-grid">
			${teamCardsHtml(data, data.teams)}
		</div>
	`;

	function afterRender() {
		const input = document.getElementById("team-search");
		const list = document.getElementById("team-list");

		input.addEventListener("input", () => {
			const filtered = filterTeams(data.teams, input.value);
			list.innerHTML = teamCardsHtml(data, filtered);
		});
	}

	return {
		html,
		afterRender
	};
}

function renderTeamPage(data, teamId, params) {
	const team = data.teamsById[teamId];

	if (!team) {
		return {
			html: emptyHtml("Team not found.")
		};
	}

	const entityArticles = getEntityArticles(data, { teamId });
	const selectedLanguages = getSelectedLanguages(params);
	const sort = getSort(params);

	const availableLanguages = [...new Set(
		entityArticles
			.map((article) => article.language)
			.filter(Boolean)
	)].sort();

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles.map((article) => articleCardHtml(data, article)).join("")
		: emptyHtml("No articles match these filters.");

	const teamDrivers = (team.driver_ids || [])
		.map((id) => data.driversById[id])
		.filter(Boolean)
		.sort((a, b) => {
			return (a.sort_name || a.name).localeCompare(b.sort_name || b.name);
		});

	const driversHtml = teamDrivers.length
		? `
			<div class="scroll-list">
				${
					teamDrivers
						.map((driver) => `
							<a href="#/driver/${esc(driver.id)}">
								${esc(driver.name)}
							</a>
						`)
						.join("")
				}
			</div>
		`
		: "—";

	const seasons = team.seasons || [];

	const seasonsHtml = seasons.length
		? `
			<div class="scroll-list">
				${seasons.map((year) => `<span>${esc(year)}</span>`).join("")}
			</div>
		`
		: "—";

	const constructorChamps = team.constructor_championships || [];

	const constructorChampsHtml = constructorChamps.length
		? `
			<div class="scroll-list">
				${constructorChamps.map((year) => `<span>${esc(year)}</span>`).join("")}
			</div>
		`
		: "—";

	const driverChamps = team.driver_championships || [];

	const driverChampsHtml = driverChamps.length
		? `
			<div class="scroll-list">
				${
					driverChamps
						.map((item) => {
							if (item && typeof item === "object") {
								const driverText = item.driver_id
									? ` — ${esc(driverName(data, item.driver_id))}`
									: "";

								return `<span>${esc(item.year)}${driverText}</span>`;
							}

							return `<span>${esc(item)}</span>`;
						})
						.join("")
				}
			</div>
		`
		: "—";

	const sidebar = `
		<aside class="sidebar">
			<div class="card">
				<h2>Team info</h2>

				<dl>
					<dt>Nationality</dt>
					<dd>${esc(team.nationality || "—")}</dd>

					<dt>Active years</dt>
					<dd>${esc(team.active_years || "—")}</dd>

					<dt>Seasons</dt>
					<dd>${seasonsHtml}</dd>

					<dt>Wins</dt>
					<dd>${team.wins ?? 0}</dd>

					<dt>Podiums</dt>
					<dd>${team.podiums ?? 0}</dd>

					<dt>Pole positions</dt>
					<dd>${team.pole_positions ?? 0}</dd>

					<dt>Fastest laps</dt>
					<dd>${team.fastest_laps ?? 0}</dd>

					<dt>Constructor titles</dt>
					<dd>${constructorChampsHtml}</dd>

					<dt>Driver titles</dt>
					<dd>${driverChampsHtml}</dd>

					<dt>Drivers</dt>
					<dd>${driversHtml}</dd>
				</dl>

				${
					team.wikipedia_url
						? `
							<p>
								<a href="${esc(team.wikipedia_url)}" target="_blank" rel="noopener">
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
			<h1>${esc(team.name)}</h1>

			<p class="muted">
				${esc(team.nationality || "")}
				${team.active_years ? ` • ${esc(team.active_years)}` : ""}
			</p>
		</section>

		<div class="layout">
			<div class="main-col">
				<div id="wiki-intro"></div>
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
		afterRender: () => {
			attachEntityFilters(`team/${team.id}`, params);
			loadWikiIntro(team.wikipedia_url, team.name);
		}
	};
}