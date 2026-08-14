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

/* Wikipedia intro (lead text + infobox image) */

const wikiSummaryCache = {};

function wikiTitleFromUrl(url) {
	if (!url) return null;

	const match = String(url).trim().match(/\/wiki\/([^?#]+)/);
	if (!match) return null;

	const title = match[1].trim();
	return title || null;
}

/*
 * Fallback image source.
 * The summary API often has no thumbnail for pages whose infobox
 * image is a logo/badge. The media-list API returns the page's images
 * in order — the first one is usually the infobox image.
 */
async function fetchWikiMediaImage(title) {
	try {
		const res = await fetch(
			"https://en.wikipedia.org/api/rest_v1/page/media-list/" + title
		);

		if (!res.ok) return "";

		const data = await res.json();
		const items = Array.isArray(data.items) ? data.items : [];

		const firstImage =
			items.find((item) => item.type === "image" && item.section_id === 0) ||
			items.find((item) => item.type === "image");

		if (!firstImage || !Array.isArray(firstImage.srcset) || !firstImage.srcset.length) {
			return "";
		}

		const entry = firstImage.srcset[0];
		if (!entry || !entry.src) return "";

		return entry.src.startsWith("//") ? "https:" + entry.src : entry.src;
	} catch (error) {
		return "";
	}
}

async function fetchWikiSummary(title) {
	if (!title) return null;
	if (wikiSummaryCache[title]) return wikiSummaryCache[title];

	// v2 key: ignores old caches that were saved without images
	const storageKey = "wiki-summary:v2:" + title;

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
		// localStorage unavailable – ignore
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

		// Fallback: grab the first real image on the page (infobox logo/photo)
		if (!summary.image) {
			summary.image = await fetchWikiMediaImage(title);
		}

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

	// Calculate Stats
	const stats = computeDriverStats(data, driver.id);
	const statRows = [];

	// Active Years (Clickable to show all races)
	statRows.push(`
		<dt>Active years</dt>
		<dd><a href="javascript:void(0)" class="stat-link" data-stat="races" data-driver="${esc(driver.id)}">${esc(driver.active_years || "—")}</a></dd>
	`);

	// Wins
	if (stats.wins > 0) {
		statRows.push(`
			<dt>Wins</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="wins" data-driver="${esc(driver.id)}">${stats.wins}</a></dd>
		`);
	}

	// Podiums vs Best Finish
	if (stats.podiums > 0) {
		statRows.push(`
			<dt>Podiums</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="podiums" data-driver="${esc(driver.id)}">${stats.podiums}</a></dd>
		`);
	} else if (stats.bestFinish !== null) {
		statRows.push(`
			<dt>Best finish</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="best-finish" data-driver="${esc(driver.id)}">${stats.bestFinish}${getOrdinal(stats.bestFinish)}</a></dd>
		`);
	}

	// Poles vs Best Grid
	if (stats.poles > 0) {
		statRows.push(`
			<dt>Pole positions</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="poles" data-driver="${esc(driver.id)}">${stats.poles}</a></dd>
		`);
	} else if (stats.bestGrid !== null) {
		statRows.push(`
			<dt>Best grid</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="best-grid" data-driver="${esc(driver.id)}">${stats.bestGrid}${getOrdinal(stats.bestGrid)}</a></dd>
		`);
	}

	// Fastest Laps
	if (stats.fastestLaps > 0) {
		statRows.push(`
			<dt>Fastest laps</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="fastest-laps" data-driver="${esc(driver.id)}">${stats.fastestLaps}</a></dd>
		`);
	}

	// Best Championship Finish
	if (stats.bestChampFinish !== null) {
		statRows.push(`
			<dt>Best championship</dt>
			<dd><a href="javascript:void(0)" class="stat-link" data-stat="best-champ" data-driver="${esc(driver.id)}">${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)}</a></dd>
		`);
	}

	// Resolve and Deduplicate Teams
	const driverTeams = [];
	const seenDriverTeamKeys = new Set();

	(driver.teams || [])
		.filter(Boolean)
		.forEach((teamName) => {
			// Use resolveTeamId to handle canonical mapping (e.g. Lotus-Ford -> Team Lotus)
			const teamId = typeof resolveTeamId === 'function' ? resolveTeamId(data, teamName) : findTeamIdByName(data, teamName);
			const team = teamId ? data.teamsById[teamId] : null;

			const key = team ? team.id : normalizeTeamKey(teamName);

			if (!key || seenDriverTeamKeys.has(key)) {
				return;
			}

			seenDriverTeamKeys.add(key);

			driverTeams.push({
				label: team ? team.name : teamName,
				html: team
					? `<a href="#/team/${esc(team.id)}">${esc(team.name)}</a>`
					: esc(teamName)
			});
		});

	driverTeams.sort((a, b) => a.label.localeCompare(b.label));
	const driverTeamLinks = driverTeams.map((team) => team.html);

	// Build Sidebar
	const sidebar = `
		<aside class="sidebar">
			<div class="card">
				<h2>Driver info</h2>

				<dl>
					<dt>Nationality</dt>
					<dd>${esc(driver.nationality || "—")}</dd>

					<dt>Born</dt>
					<dd>${esc(driver.date_of_birth || "—")}</dd>

					${driver.date_of_death ? `
						<dt>Died</dt>
						<dd>${esc(driver.date_of_death)}</dd>
					` : ""}

					${statRows.join("")}

					<dt>Teams</dt>
					<dd>${driverTeamLinks.length ? driverTeamLinks.join(", ") : "—"}</dd>
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

	// Build Main HTML
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

	// Return with Event Listeners attached
	return {
		html,
		afterRender: () => {
			attachEntityFilters(`driver/${driver.id}`, params);
			loadWikiIntro(driver.wikipedia_url, driver.name);

			// Hook up the stat modal triggers
			document.querySelectorAll('.stat-link').forEach(link => {
				link.addEventListener('click', (e) => {
					e.preventDefault(); // Prevent default anchor behavior
					const stat = e.currentTarget.getAttribute('data-stat');
					const dId = e.currentTarget.getAttribute('data-driver');
					showStatModal(data, dId, stat);
				});
			});
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

	// Dynamically check which time columns actually have valid data for THIS race
	const hasQ1 = race.qualifying.some(r => r.q1 && r.q1 !== "—" && r.q1 !== "-" && r.q1 !== "" && r.q1 !== "no time");
	const hasQ2 = race.qualifying.some(r => r.q2 && r.q2 !== "—" && r.q2 !== "-" && r.q2 !== "" && r.q2 !== "no time");
	const hasQ3 = race.qualifying.some(r => r.q3 && r.q3 !== "—" && r.q3 !== "-" && r.q3 !== "" && r.q3 !== "no time");

	// If none of the knockout sessions exist, just show a single "Time" column
	const showSingleTime = !hasQ1 && !hasQ2 && !hasQ3;

	let headerCols = `<th>Pos</th><th>Driver</th><th>Constructor</th>`;
	if (showSingleTime) {
		headerCols += `<th>Time</th>`;
	} else {
		if (hasQ1) headerCols += `<th>Q1</th>`;
		if (hasQ2) headerCols += `<th>Q2</th>`;
		if (hasQ3) headerCols += `<th>Q3</th>`;
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
				? `<a href="#/driver/${esc(driver.id)}">${esc(driver.name)}</a>`
				: esc(q.driver_id || "—");

			let timeCols = "";
			if (showSingleTime) {
				const time = (q.q1 && q.q1 !== "no time" ? q.q1 : "") || (q.q2 && q.q2 !== "no time" ? q.q2 : "") || (q.q3 && q.q3 !== "no time" ? q.q3 : "") || "—";
				timeCols = `<td>${esc(time)}</td>`;
			} else {
				if (hasQ1) timeCols += `<td>${esc((q.q1 && q.q1 !== "no time") ? q.q1 : "—")}</td>`;
				if (hasQ2) timeCols += `<td>${esc((q.q2 && q.q2 !== "no time") ? q.q2 : "—")}</td>`;
				if (hasQ3) timeCols += `<td>${esc((q.q3 && q.q3 !== "no time") ? q.q3 : "—")}</td>`;
			}

			return `
				<tr>
					<td>${esc(q.position || "—")}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, q.team)}</td>
					${timeCols}
				</tr>
			`;
		})
		.join("");

	return `
		<div class="table-wrap">
			<table>
				<thead>
					<tr>${headerCols}</tr>
				</thead>
				<tbody>${rows}</tbody>
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

const TEAM_CANONICAL_BY_NAME = {
	"lotus": "team-lotus",
	"lotus-ford": "team-lotus",
	"lotus-climax": "team-lotus",
	"lotus-borgward": "team-lotus",
	"lotus-pratt whitney": "team-lotus",
	"lotus-pratt-amp-whitney": "team-lotus",
	"brabham-ford": "brabham",
	"brabham-climax": "brabham",
	"brabham-brm": "brabham",
	"brabham-alfa romeo": "brabham",
	"brabham-repco": "brabham",
	"cooper-climax": "cooper",
	"cooper-maserati": "cooper",
	"cooper-brm": "cooper",
	"cooper-alfa romeo": "cooper",
	"cooper-ats": "cooper",
	"cooper-borgward": "cooper",
	"cooper-castellotti": "cooper",
	"cooper-ferrari": "cooper",
	"cooper-osca": "cooper",
	"mclaren-ford": "mclaren",
	"mclaren-serenissima": "mclaren",
	"eagle-climax": "eagle",
	"eagle-weslake": "eagle",
	"de tomaso-alfa romeo": "de-tomaso",
	"de tomaso-osca": "de-tomaso",
	"brm-ford": "brm"
};

function findTeamIdByName(data, teamName) {
	if (!teamName || !data.teamsByName) {
		return null;
	}
	const norm = normalizeTeamKey(teamName);
	if (!norm || norm === "—") {
		return null;
	}

	// Check canonical overrides
	if (TEAM_CANONICAL_BY_NAME[norm]) {
		return TEAM_CANONICAL_BY_NAME[norm];
	}

	// Exact match
	if (data.teamsByName[norm]) {
		return data.teamsByName[norm];
	}

	// Try parts before hyphen
	const parts = norm
		.split(/[-–—/]/)
		.map((part) => part.trim())
		.filter(Boolean);
	for (const part of parts) {
		if (TEAM_CANONICAL_BY_NAME[part]) return TEAM_CANONICAL_BY_NAME[part];
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

function resolveTeamId(data, teamName) {
  return findTeamIdByName(data, teamName);
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
		return { html: emptyHtml("Team not found.") };
	}

	const entityArticles = getEntityArticles(data, { teamId });
	const selectedLanguages = getSelectedLanguages(params);
	const sort = getSort(params);

	const availableLanguages = [...new Set(
		entityArticles.map((article) => article.language).filter(Boolean)
	)].sort();

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles.map((article) => articleCardHtml(data, article)).join("")
		: emptyHtml("No articles match these filters.");

	// Compute Stats
	const stats = computeTeamStats(data, team.id);
	const statRows = [];

	statRows.push(`
		<dt>Active years</dt>
		<dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="races" data-team="${esc(team.id)}">${esc(team.active_years || "—")}</a></dd>
	`);

	if (stats.wins > 0) {
		statRows.push(`<dt>Wins</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="wins" data-team="${esc(team.id)}">${stats.wins}</a></dd>`);
	}

	if (stats.podiums > 0) {
		statRows.push(`<dt>Podiums</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="podiums" data-team="${esc(team.id)}">${stats.podiums}</a></dd>`);
	} else if (stats.bestFinish !== null) {
		statRows.push(`<dt>Best finish</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="best-finish" data-team="${esc(team.id)}">${stats.bestFinish}${getOrdinal(stats.bestFinish)}</a></dd>`);
	}

	if (stats.poles > 0) {
		statRows.push(`<dt>Pole positions</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="poles" data-team="${esc(team.id)}">${stats.poles}</a></dd>`);
	} else if (stats.bestGrid !== null) {
		statRows.push(`<dt>Best grid</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="best-grid" data-team="${esc(team.id)}">${stats.bestGrid}${getOrdinal(stats.bestGrid)}</a></dd>`);
	}

	if (stats.fastestLaps > 0) {
		statRows.push(`<dt>Fastest laps</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="fastest-laps" data-team="${esc(team.id)}">${stats.fastestLaps}</a></dd>`);
	}

	if (stats.bestChampFinish !== null) {
		statRows.push(`<dt>Best championship</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="best-champ" data-team="${esc(team.id)}">${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)}</a></dd>`);
	}

	// Constructor Titles (Clickable)
	const constructorTitles = (team.constructor_championships || []).length;
	if (constructorTitles > 0) {
		statRows.push(`<dt>Constructor titles</dt><dd><a href="javascript:void(0)" class="stat-link team-stat-link" data-stat="constructor-titles" data-team="${esc(team.id)}">${constructorTitles}</a></dd>`);
	} else {
		statRows.push(`<dt>Constructor titles</dt><dd>0</dd>`);
	}

	// Build Sidebar Sub-components safely
	const seasons = team.seasons || [];
	const seasonsHtml = seasons.length
		? `<div class="scroll-list">${seasons.map((year) => `<span>${esc(year)}</span>`).join("")}</div>`
		: "—";

	const driverChamps = team.driver_championships || [];
	const driverChampsHtml = driverChamps.length
		? `<div class="scroll-list">${
			driverChamps.map((item) => {
				if (item && typeof item === "object") {
					const driverObj = data.driversById[item.driver_id];
					const driverText = driverObj ? ` — ${esc(driverObj.name)}` : "";
					return `<span>${esc(item.year)}${driverText}</span>`;
				}
				return `<span>${esc(item)}</span>`;
			}).join("")
		  }</div>`
		: "—";

	const teamDrivers = (team.driver_ids || [])
		.map((id) => data.driversById[id])
		.filter(Boolean)
		.sort((a, b) => (a.sort_name || a.name).localeCompare(b.sort_name || b.name));

	const driversHtml = teamDrivers.length
		? `<div class="scroll-list">${
			teamDrivers.map((driver) => `<a href="#/driver/${esc(driver.id)}">${esc(driver.name)}</a>`).join("")
		  }</div>`
		: "—";

	// Build Sidebar
	const sidebar = `
		<aside class="sidebar">
			<div class="card">
				<h2>Team info</h2>

				<dl>
					<dt>Nationality</dt>
					<dd>${esc(team.nationality || "—")}</dd>

					${statRows.join("")}

					<dt>Seasons</dt>
					<dd>${seasonsHtml}</dd>

					<dt>Driver titles</dt>
					<dd>${driverChampsHtml}</dd>

					<dt>Drivers</dt>
					<dd>${driversHtml}</dd>
				</dl>

				${
					team.wikipedia_url
						? `<p><a href="${esc(team.wikipedia_url)}" target="_blank" rel="noopener">Wikipedia</a></p>`
						: ""
				}
			</div>

			<div class="card">
				<h2>Articles</h2>
				<p class="muted">${filteredArticles.length} shown / ${entityArticles.length} total</p>
			</div>
		</aside>
	`;

	// Main HTML
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

	// Return with Event Listeners
	return {
		html,
		afterRender: () => {
			attachEntityFilters(`team/${team.id}`, params);
			loadWikiIntro(team.wikipedia_url, team.name);

			document.querySelectorAll('.team-stat-link').forEach(link => {
				link.addEventListener('click', (e) => {
					e.preventDefault();
					const stat = e.currentTarget.getAttribute('data-stat');
					const tId = e.currentTarget.getAttribute('data-team');
					showTeamStatModal(data, tId, stat);
				});
			});
		}
	};
}

/* Driver Career Stats */

function getOrdinal(n) {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return s[(v - 20) % 10] || s[v] || s[0];
}

function getDriverGridPos(p) {
	// Official API starting grid (highest priority, most reliable)
	if (p.result && p.result.grid) {
		const g = parseInt(p.result.grid, 10);
		if (!isNaN(g) && g > 0) return g;
	}
	// Scraped starting_grid array
	if (p.grid && p.grid.position) {
		const g = parseInt(p.grid.position, 10);
		if (!isNaN(g) && g > 0) return g;
	}
	// Scraped qualifying array
	if (p.quali && p.quali.position) {
		const g = parseInt(p.quali.position, 10);
		if (!isNaN(g) && g > 0) return g;
	}
	return null;
}

function computeDriverStats(data, driverId) {
	const participations = [];
	
	data.races.forEach(race => {
		const qualiEntry = (race.qualifying || []).find(q => q.driver_id === driverId);
		const resultEntry = (race.results || []).find(r => r.driver_id === driverId);
		const gridEntry = (race.starting_grid || []).find(g => g.driver_id === driverId);

		if (qualiEntry || resultEntry || gridEntry) {
			participations.push({ race, quali: qualiEntry, result: resultEntry, grid: gridEntry });
		}
	});

	const wins = participations.filter(p => p.result && String(p.result.position || p.result.positionText) === "1").length;
	const podiums = participations.filter(p => p.result && ["1", "2", "3"].includes(String(p.result.position || p.result.positionText))).length;
	
	const poles = participations.filter(p => getDriverGridPos(p) === 1).length;
	
	const fastestLaps = participations.filter(p => p.result && String(p.result.fastest_lap_rank) === "1").length;

	const finishes = participations.map(p => p.result ? parseInt(p.result.position || p.result.positionText, 10) : NaN).filter(n => !isNaN(n));
	const bestFinish = finishes.length ? Math.min(...finishes) : null;

	const grids = participations.map(p => getDriverGridPos(p)).filter(n => n !== null);
	const bestGrid = grids.length ? Math.min(...grids) : null;

	return {
		participations,
		racesEntered: participations.length,
		wins, podiums, poles, fastestLaps,
		bestFinish, bestGrid
	};
}

function closeStatModal() {
	const container = document.getElementById('stat-modal-container');
	if (container) container.remove();
	document.body.style.overflow = '';
}

function computeDriverStats(data, driverId) {
	const participations = [];
	
	data.races.forEach(race => {
		const qualiEntry = (race.qualifying || []).find(q => q.driver_id === driverId);
		const resultEntry = (race.results || []).find(r => r.driver_id === driverId);
		const gridEntry = (race.starting_grid || []).find(g => g.driver_id === driverId);

		if (qualiEntry || resultEntry || gridEntry) {
			participations.push({ race, quali: qualiEntry, result: resultEntry, grid: gridEntry });
		}
	});

	const wins = participations.filter(p => p.result && String(p.result.position || p.result.positionText) === "1").length;
	const podiums = participations.filter(p => p.result && ["1", "2", "3"].includes(String(p.result.position || p.result.positionText))).length;
	const poles = participations.filter(p => getDriverGridPos(p) === 1).length;
	const fastestLaps = participations.filter(p => p.result && String(p.result.fastest_lap_rank) === "1").length;

	const finishes = participations.map(p => p.result ? parseInt(p.result.position || p.result.positionText, 10) : NaN).filter(n => !isNaN(n));
	const bestFinish = finishes.length ? Math.min(...finishes) : null;

	const grids = participations.map(p => getDriverGridPos(p)).filter(n => n !== null);
	const bestGrid = grids.length ? Math.min(...grids) : null;

	// Championship Stats
	const driver = data.driversById[driverId];
	const champResults = driver.championship_results || [];
	const bestChampFinish = champResults.length ? Math.min(...champResults.map(r => r.position)) : null;
	const bestChampYears = champResults.filter(r => r.position === bestChampFinish).map(r => r.year);

	return {
		participations,
		racesEntered: participations.length,
		wins, podiums, poles, fastestLaps,
		bestFinish, bestGrid,
		champResults, bestChampFinish, bestChampYears
	};
}

function computeTeamStats(data, teamId) {
	const participations = [];
	
	data.races.forEach(race => {
		const resultEntries = (race.results || []).filter(r => resolveTeamId(data, r.team) === teamId);
		const qualiEntries = (race.qualifying || []).filter(q => resolveTeamId(data, q.team) === teamId);
		const gridEntries = (race.starting_grid || []).filter(g => resolveTeamId(data, g.team) === teamId);

		if (resultEntries.length || qualiEntries.length || gridEntries.length) {
			participations.push({ race, results: resultEntries, qualis: qualiEntries, grids: gridEntries });
		}
	});

	let wins = 0, podiums = 0, poles = 0, fastestLaps = 0;
	let bestFinish = null;
	let bestGrid = null;

	participations.forEach(p => {
		p.results.forEach(r => {
			const pos = parseInt(r.position || r.positionText, 10);
			if (!isNaN(pos)) {
				if (pos === 1) wins++;
				if (pos <= 3) podiums++;
				if (bestFinish === null || pos < bestFinish) bestFinish = pos;
			}
			if (String(r.fastest_lap_rank) === "1") fastestLaps++;
			
			const gridPos = parseInt(r.grid, 10);
			if (!isNaN(gridPos) && gridPos > 0) {
				if (gridPos === 1) poles++;
				if (bestGrid === null || gridPos < bestGrid) bestGrid = gridPos;
			}
		});
		
		[...p.qualis, ...p.grids].forEach(q => {
			const gPos = parseInt(q.position, 10);
			if (!isNaN(gPos) && gPos > 0) {
				if (gPos === 1) poles++;
				if (bestGrid === null || gPos < bestGrid) bestGrid = gPos;
			}
		});
	});

	const team = data.teamsById[teamId];
	const champResults = team.championship_results || [];
	const bestChampFinish = champResults.length ? Math.min(...champResults.map(r => r.position)) : null;

	return {
		participations,
		racesEntered: participations.length,
		wins, podiums, poles, fastestLaps,
		bestFinish, bestGrid,
		champResults, bestChampFinish
	};
}

/* Helpers for Stats Modals */

function renderModal(title, count, countNoun, listHtml) {
	const modalHtml = `
		<div class="stat-modal-overlay" id="stat-modal">
			<div class="stat-modal">
				<button class="stat-modal-close" aria-label="Close">&times;</button>
				<h2>${esc(title)}</h2>
				<p class="muted">${count} ${countNoun}${count === 1 ? '' : 's'}</p>
				<div class="stat-modal-content">${listHtml}</div>
			</div>
		</div>
	`;
	const modalContainer = document.createElement('div');
	modalContainer.id = 'stat-modal-container';
	modalContainer.innerHTML = modalHtml;
	document.body.appendChild(modalContainer);
	
	document.querySelector('.stat-modal-close').addEventListener('click', closeStatModal);
	document.querySelector('.stat-modal-overlay').addEventListener('click', (e) => {
		if (e.target.id === 'stat-modal') closeStatModal();
	});
	document.body.style.overflow = 'hidden';
}

function getDriverTeamInYear(data, driverId, year) {
	for (const race of data.races) {
		if (race.season == year) {
			const res = (race.results || []).find(r => r.driver_id === driverId);
			if (res && res.team) return res.team;
			const grid = (race.starting_grid || []).find(g => g.driver_id === driverId);
			if (grid && grid.team) return grid.team;
			const quali = (race.qualifying || []).find(q => q.driver_id === driverId);
			if (quali && quali.team) return quali.team;
		}
	}
	return "";
}

function getTeamDriversInYear(data, teamId, year) {
	const drivers = new Set();
	for (const race of data.races) {
		if (race.season == year) {
			(race.results || []).forEach(r => {
				if (resolveTeamId(data, r.team) === teamId) drivers.add(r.driver_id);
			});
			(race.starting_grid || []).forEach(g => {
				if (resolveTeamId(data, g.team) === teamId) drivers.add(g.driver_id);
			});
		}
	}
	return Array.from(drivers);
}

/* Race Entry Formatters */

function formatRaceEntry(data, p) {
	const raceName = `${p.race.name} ${p.race.season || ''}`;
	const raceLink = `#/race/${p.race.id}`;
	let details = [];
	
	// Add Team Link
	const teamName = p.result ? p.result.team : (p.grid ? p.grid.team : (p.quali ? p.quali.team : ""));
	if (teamName) {
		details.push(teamLinkHtml(data, teamName));
	}

	// Add Grid Position
	const gridPos = getDriverGridPos(p);
	const isPole = gridPos === 1;

	if (gridPos !== null) {
		details.push(`Grid ${gridPos}${isPole ? ' (Pole)' : ''}`);
	} else if (p.quali && p.quali.position && !/^\d+$/.test(String(p.quali.position))) {
		details.push(String(p.quali.position)); 
	}

	// Add Race Result
	if (p.result) {
		const status = p.result.status || p.result.statusText || "";
		const pos = String(p.result.position || p.result.positionText || "");
		
		if (/^\d+$/.test(pos)) {
			details.push(`Finished ${pos}${getOrdinal(parseInt(pos, 10))}`);
		} else if (pos === "DSQ" || status === "Disqualified") {
			details.push(`DSQ`);
		} else if (status && status !== "Finished") {
			details.push(`Retired (${status})`);
		} else if (!status) {
			details.push(`Retired`); 
		}
	} else {
		if (gridPos !== null) {
			details.push('No race result');
		} else {
			details.push('Did not qualify / Did not start');
		}
	}

	return `<li><a href="${raceLink}">${esc(raceName)}</a> <span class="muted">${details.join(' • ')}</span></li>`;
}

function formatTeamRaceEntry(data, p, statType) {
	const raceName = `${p.race.name} ${p.race.season || ''}`;
	const raceLink = `#/race/${p.race.id}`;
	let details = [];

	const makeDriverLink = (did) => {
		const d = data.driversById[did];
		return d ? `<a href="#/driver/${esc(d.id)}">${esc(d.name)}</a>` : esc(did);
	};

	if (statType === "races") {
		p.results.forEach(r => {
			const pos = r.position || r.positionText;
			details.push(`${makeDriverLink(r.driver_id)}: P${pos}`);
		});
	} else if (statType === "wins") {
		p.results.filter(r => String(r.position || r.positionText) === "1").forEach(r => {
			details.push(`${makeDriverLink(r.driver_id)} won`);
		});
	} else if (statType === "podiums") {
		p.results.filter(r => ["1", "2", "3"].includes(String(r.position || r.positionText))).forEach(r => {
			const pos = r.position || r.positionText;
			details.push(`${makeDriverLink(r.driver_id)} finished ${pos}${getOrdinal(parseInt(pos, 10))}`);
		});
	} else if (statType === "poles") {
		const poleDrivers = new Set();
		p.results.filter(r => parseInt(r.grid, 10) === 1).forEach(r => poleDrivers.add(r.driver_id));
		p.qualis.filter(q => parseInt(q.position, 10) === 1).forEach(q => poleDrivers.add(q.driver_id));
		p.grids.filter(g => parseInt(g.position, 10) === 1).forEach(g => poleDrivers.add(g.driver_id));
		
		poleDrivers.forEach(did => {
			details.push(`${makeDriverLink(did)} on pole`);
		});
	} else if (statType === "fastest-laps") {
		p.results.filter(r => String(r.fastest_lap_rank) === "1").forEach(r => {
			details.push(`${makeDriverLink(r.driver_id)} fastest lap`);
		});
	} else {
		p.results.forEach(r => {
			const pos = r.position || r.positionText;
			details.push(`${makeDriverLink(r.driver_id)}: P${pos}`);
		});
	}

	return `<li><a href="${raceLink}">${esc(raceName)}</a> <span class="muted">${details.join(' • ')}</span></li>`;
}

/* Modal Controllers */

function showStatModal(data, driverId, statType) {
	const driver = data.driversById[driverId];
	if (!driver) return;
	
	const stats = computeDriverStats(data, driverId);
	const participations = stats.participations;
	let title = "";
	let filtered = [];
	
	if (statType === "races") {
		title = `${driver.name} - All Races`;
		filtered = participations;
	} else if (statType === "wins") {
		title = `${driver.name} - Wins`;
		filtered = participations.filter(p => p.result && String(p.result.position || p.result.positionText) === "1");
	} else if (statType === "podiums") {
		title = `${driver.name} - Podiums`;
		filtered = participations.filter(p => p.result && ["1", "2", "3"].includes(String(p.result.position || p.result.positionText)));
	} else if (statType === "poles") {
		title = `${driver.name} - Pole Positions`;
		filtered = participations.filter(p => getDriverGridPos(p) === 1);
	} else if (statType === "fastest-laps") {
		title = `${driver.name} - Fastest Laps`;
		filtered = participations.filter(p => p.result && String(p.result.fastest_lap_rank) === "1");
	} else if (statType === "best-finish") {
		title = `${driver.name} - Best Finishes (${stats.bestFinish}${getOrdinal(stats.bestFinish)})`;
		filtered = participations.filter(p => p.result && parseInt(p.result.position || p.result.positionText, 10) === stats.bestFinish);
	} else if (statType === "best-grid") {
		title = `${driver.name} - Best Grid Positions (${stats.bestGrid}${getOrdinal(stats.bestGrid)})`;
		filtered = participations.filter(p => getDriverGridPos(p) === stats.bestGrid);
	} else if (statType === "best-champ") {
		const isChampion = parseInt(stats.bestChampFinish, 10) === 1;
		title = isChampion 
			? `${driver.name} - World Championships` 
			: `${driver.name} - Best Championship Finishes (${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)})`;
			
		const champResults = (driver.championship_results || [])
			.filter(r => parseInt(r.position, 10) === parseInt(stats.bestChampFinish, 10))
			.sort((a, b) => a.year - b.year);
		
		let listHtml = `<ul class="stat-list">`;
		champResults.forEach(r => {
			const teamName = getDriverTeamInYear(data, driverId, r.year);
			const teamHtml = teamName ? ` • ${teamLinkHtml(data, teamName)}` : "";
			const label = isChampion ? "World Champion" : `Finished ${r.position}${getOrdinal(r.position)}`;
			listHtml += `<li><span>${r.year}</span> <span class="muted">${label}${teamHtml}${r.points ? ` • ${r.points} pts` : ""}</span></li>`;
		});
		listHtml += `</ul>`;
		
		if (!champResults.length) listHtml = `<p class="muted">No championship finishes recorded.</p>`;
		
		renderModal(title, champResults.length, "season", listHtml);
		return;
	}

	filtered.sort((a, b) => String(b.race.date || b.race.season).localeCompare(String(a.race.date || a.race.season)));

	let listHtml = "";
	if (statType === "races") {
		const grouped = {};
		filtered.forEach(p => {
			const year = p.race.season || "Unknown";
			if (!grouped[year]) grouped[year] = [];
			grouped[year].push(p);
		});
		const years = Object.keys(grouped).sort((a,b) => b - a);
		years.forEach(year => {
			listHtml += `<h3 class="modal-year">${esc(year)}</h3><ul class="stat-list">`;
			grouped[year].forEach(p => listHtml += formatRaceEntry(data, p));
			listHtml += `</ul>`;
		});
	} else {
		listHtml = `<ul class="stat-list">`;
		filtered.forEach(p => listHtml += formatRaceEntry(data, p));
		listHtml += `</ul>`;
	}

	if (!filtered.length) listHtml = `<p class="muted">No races found.</p>`;

	renderModal(title, filtered.length, "race", listHtml);
}

function showTeamStatModal(data, teamId, statType) {
	const team = data.teamsById[teamId];
	if (!team) return;
	
	const stats = computeTeamStats(data, teamId);
	const participations = stats.participations;
	let title = "";
	let filtered = [];
	
	if (statType === "races") {
		title = `${team.name} - All Races`;
		filtered = participations;
	} else if (statType === "wins") {
		title = `${team.name} - Wins`;
		filtered = participations.filter(p => p.results.some(r => String(r.position || r.positionText) === "1"));
	} else if (statType === "podiums") {
		title = `${team.name} - Podiums`;
		filtered = participations.filter(p => p.results.some(r => ["1", "2", "3"].includes(String(r.position || r.positionText))));
	} else if (statType === "poles") {
		title = `${team.name} - Pole Positions`;
		filtered = participations.filter(p => {
			return p.results.some(r => parseInt(r.grid, 10) === 1) || 
						 p.qualis.some(q => parseInt(q.position, 10) === 1) ||
						 p.grids.some(g => parseInt(g.position, 10) === 1);
		});
	} else if (statType === "fastest-laps") {
		title = `${team.name} - Fastest Laps`;
		filtered = participations.filter(p => p.results.some(r => String(r.fastest_lap_rank) === "1"));
	} else if (statType === "best-finish") {
		title = `${team.name} - Best Finishes (${stats.bestFinish}${getOrdinal(stats.bestFinish)})`;
		filtered = participations.filter(p => p.results.some(r => parseInt(r.position || r.positionText, 10) === stats.bestFinish));
	} else if (statType === "best-grid") {
		title = `${team.name} - Best Grid Positions (${stats.bestGrid}${getOrdinal(stats.bestGrid)})`;
		filtered = participations.filter(p => {
			return p.results.some(r => parseInt(r.grid, 10) === stats.bestGrid) || 
						 p.qualis.some(q => parseInt(q.position, 10) === stats.bestGrid) ||
						 p.grids.some(g => parseInt(g.position, 10) === stats.bestGrid);
		});
	} else if (statType === "constructor-titles") {
		title = `${team.name} - Constructor Championships`;
		const titles = (team.constructor_championships || []).sort((a, b) => a - b);
		
		let listHtml = `<ul class="stat-list">`;
		titles.forEach(year => {
			const driverIds = getTeamDriversInYear(data, teamId, year);
			const driversHtml = driverIds.map(did => {
				const d = data.driversById[did];
				return d ? `<a href="#/driver/${esc(d.id)}">${esc(d.name)}</a>` : esc(did);
			}).join(", ") || "Unknown drivers";
			
			listHtml += `<li><span>${year}</span> <span class="muted">Constructor Champion • ${driversHtml}</span></li>`;
		});
		listHtml += `</ul>`;
		
		if (!titles.length) listHtml = `<p class="muted">No constructor championships recorded.</p>`;
		
		renderModal(title, titles.length, "title", listHtml);
		return;
	} else if (statType === "best-champ") {
		const isChampion = parseInt(stats.bestChampFinish, 10) === 1;
		title = isChampion 
			? `${team.name} - Constructor Championships` 
			: `${team.name} - Best Championship Finishes (${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)})`;
			
		const champResults = (team.championship_results || [])
			.filter(r => parseInt(r.position, 10) === parseInt(stats.bestChampFinish, 10))
			.sort((a, b) => a.year - b.year);
		
		let listHtml = `<ul class="stat-list">`;
		champResults.forEach(r => {
			const driverIds = getTeamDriversInYear(data, teamId, r.year);
			const driversHtml = driverIds.map(did => {
				const d = data.driversById[did];
				return d ? `<a href="#/driver/${esc(d.id)}">${esc(d.name)}</a>` : esc(did);
			}).join(", ") || "Unknown drivers";
			
			const label = isChampion ? "Constructor Champion" : `Finished ${r.position}${getOrdinal(r.position)}`;
			listHtml += `<li><span>${r.year}</span> <span class="muted">${label} • ${driversHtml}${r.points ? ` • ${r.points} pts` : ""}</span></li>`;
		});
		listHtml += `</ul>`;
		
		if (!champResults.length) listHtml = `<p class="muted">No championship finishes recorded.</p>`;
		
		renderModal(title, champResults.length, "season", listHtml);
		return;
	}

	filtered.sort((a, b) => String(b.race.date || b.race.season).localeCompare(String(a.race.date || a.race.season)));

	let listHtml = "";
	if (statType === "races") {
		const grouped = {};
		filtered.forEach(p => {
			const year = p.race.season || "Unknown";
			if (!grouped[year]) grouped[year] = [];
			grouped[year].push(p);
		});
		const years = Object.keys(grouped).sort((a,b) => b - a);
		years.forEach(year => {
			listHtml += `<h3 class="modal-year">${esc(year)}</h3><ul class="stat-list">`;
			grouped[year].forEach(p => listHtml += formatTeamRaceEntry(data, p, statType));
			listHtml += `</ul>`;
		});
	} else {
		listHtml = `<ul class="stat-list">`;
		filtered.forEach(p => listHtml += formatTeamRaceEntry(data, p, statType));
		listHtml += `</ul>`;
	}

	if (!filtered.length) listHtml = `<p class="muted">No races found.</p>`;

	renderModal(title, filtered.length, "race", listHtml);
}