"use strict";

const app = document.getElementById("app");

const state = {
	data: null
};

const uiState = {
	driverSearch: "",
	teamSearch: ""
};

const caches = {
	teamParticipation: null,
	racesByYear: null,
	teamId: new Map(),
	wikiSummary: new Map(),
	driverStats: new Map(),
	teamStats: new Map()
};

const KNOWN_DRIVER_STATS = new Set([
	"races",
	"wins",
	"podiums",
	"poles",
	"fastest-laps",
	"best-finish",
	"best-grid",
	"best-champ"
]);

const KNOWN_TEAM_STATS = new Set([
	"races",
	"wins",
	"podiums",
	"poles",
	"fastest-laps",
	"best-finish",
	"best-grid",
	"constructor-titles",
	"best-champ"
]);

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

let wikiIntroRequestId = 0;
let articleContentRequestId = 0;
let lastFocusedElement = null;

function init() {
	if (!app) {
		console.error("Missing #app element.");
		return;
	}

	loadData()
		.then(data => {
			state.data = data;

			app.addEventListener("click", handleAppClick);

			route();
			window.addEventListener("hashchange", route);
		})
		.catch(error => {
			console.error(error);
			app.innerHTML = `
				<div class="empty">
					Could not load data. Check the browser console and make sure all JSON files are valid.
				</div>
			`;
		});
}

function handleAppClick(e) {
	if (!state.data) return;

	const trigger = e.target.closest("[data-stat]");
	if (!trigger) return;

	if (trigger.tagName === "A") {
		e.preventDefault();
	}

	const stat = trigger.getAttribute("data-stat");
	if (!stat) return;

	const driverId = trigger.getAttribute("data-driver");
	const teamId = trigger.getAttribute("data-team");

	if (driverId) {
		showStatModal(state.data, driverId, stat);
	} else if (teamId) {
		showTeamStatModal(state.data, teamId, stat);
	}
}

function clearCaches() {
	caches.teamParticipation = null;
	caches.racesByYear = null;
	caches.teamId.clear();
	caches.driverStats.clear();
	caches.teamStats.clear();
}

function clearAllCaches() {
	clearCaches();
	caches.wikiSummary.clear();
	wikiIntroRequestId++;
	articleContentRequestId++;
}

async function loadData() {
	clearAllCaches();

	const [
		languagesRaw,
		driversRaw,
		racesRaw,
		articlesRaw,
		teamsRaw
	] = await Promise.all([
		fetch("data/languages.json").then(checkResponse),
		fetch("data/drivers.json").then(checkResponse),
		fetch("data/races.json").then(checkResponse),
		fetch("data/articles.json").then(checkResponse),
		fetchOptionalJson("data/teams.json")
	]);

	if (!Array.isArray(languagesRaw)) {
		throw new Error("languages.json must be an array.");
	}

	if (!Array.isArray(driversRaw)) {
		throw new Error("drivers.json must be an array.");
	}

	if (!Array.isArray(racesRaw)) {
		throw new Error("races.json must be an array.");
	}

	if (!Array.isArray(articlesRaw)) {
		throw new Error("articles.json must be an array.");
	}

	const languages = languagesRaw.filter(isObject);

	const drivers = sortDrivers(
		driversRaw.filter(isObject).filter(hasValidId)
	).map(driver => ({
		...driver,
		_searchText: driverSearchText(driver)
	}));

	const races = racesRaw.filter(isObject).filter(hasValidId);
	const articles = articlesRaw.filter(isObject).filter(hasValidId);

	const teams = sortTeams(
		(Array.isArray(teamsRaw) ? teamsRaw : []).filter(isObject).filter(hasValidId)
	).map(team => ({
		...team,
		_searchText: teamSearchText(team)
	}));

	const driversById = makeById(drivers, "driver");
	const teamsById = makeById(teams, "team");
	const racesById = makeById(races, "race");
	const articlesById = makeById(articles, "article");

	const languagesByCode = languages.reduce((acc, item) => {
		if (!item || item.code === null || item.code === undefined || item.code === "") {
			return acc;
		}

		const code = String(item.code);

		if (!acc[code]) {
			acc[code] = item;
		} else {
			console.warn(`Duplicate language code: ${code}`);
		}

		return acc;
	}, Object.create(null));

	const driverRacesIndex = Object.create(null);

	races.forEach(race => {
		const allDrivers = new Set();

		asArray(race.results)
			.filter(isObject)
			.forEach(entry => addIdToSet(allDrivers, entry.driver_id));

		asArray(race.qualifying)
			.filter(isObject)
			.forEach(entry => addIdToSet(allDrivers, entry.driver_id));

		asArray(race.starting_grid)
			.filter(isObject)
			.forEach(entry => addIdToSet(allDrivers, entry.driver_id));

		allDrivers.forEach(driverId => {
			if (!driverRacesIndex[driverId]) {
				driverRacesIndex[driverId] = [];
			}

			driverRacesIndex[driverId].push(race);
		});
	});

	const articlesByDriver = Object.create(null);
	const articlesByTeam = Object.create(null);
	const articlesByRace = Object.create(null);
	const allArticleLanguages = new Set();

	articles.forEach(article => {
		if (article.language) {
			allArticleLanguages.add(article.language);
		}

		uniqueIds(article.driver_ids).forEach(driverId => {
			if (!articlesByDriver[driverId]) {
				articlesByDriver[driverId] = [];
			}
			articlesByDriver[driverId].push(article);
		});

		uniqueIds(article.team_ids).forEach(teamId => {
			if (!articlesByTeam[teamId]) {
				articlesByTeam[teamId] = [];
			}
			articlesByTeam[teamId].push(article);
		});

		uniqueIds(article.race_ids).forEach(raceId => {
			if (!articlesByRace[raceId]) {
				articlesByRace[raceId] = [];
			}
			articlesByRace[raceId].push(article);
		});
	});

	return {
		languages,
		drivers,
		races,
		articles,
		teams,

		driversById,
		teamsById,
		racesById,
		articlesById,
		languagesByCode,

		teamsByName: makeTeamsByName(teams),

		driverRacesIndex,
		articlesByDriver,
		articlesByTeam,
		articlesByRace,

		allArticleLanguages: Array.from(allArticleLanguages).sort()
	};
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

function isObject(value) {
	return value !== null && typeof value === "object";
}

function asArray(value) {
	if (value === null || value === undefined) {
		return [];
	}

	return Array.isArray(value) ? value : [value];
}

function hasOwn(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function hasValidId(item) {
	return Boolean(
		item &&
		item.id !== null &&
		item.id !== undefined &&
		String(item.id).trim() !== ""
	);
}

function addIdToSet(set, id) {
	if (id === null || id === undefined || String(id).trim() === "") {
		return;
	}

	set.add(String(id));
}

function uniqueIds(value) {
	return [...new Set(
		asArray(value)
			.filter(id => id !== null && id !== undefined && String(id).trim() !== "")
			.map(String)
	)];
}

function makeById(items, label = "item") {
	return (Array.isArray(items) ? items : []).reduce((acc, item) => {
		if (!hasValidId(item)) {
			console.warn(`Missing id for ${label}:`, item);
			return acc;
		}

		const id = String(item.id);

		if (acc[id]) {
			console.warn(`Duplicate ${label} id: ${id}. Keeping first occurrence.`);
			return acc;
		}

		acc[id] = item;
		return acc;
	}, Object.create(null));
}

function sortDrivers(drivers) {
	return [...drivers].sort((a, b) => {
		return String(a.sort_name || a.name || "").localeCompare(
			String(b.sort_name || b.name || "")
		);
	});
}

function sortTeams(teams) {
	return [...teams].sort((a, b) => {
		return String(a.name || "").localeCompare(String(b.name || ""));
	});
}

function driverSearchText(driver) {
	const parts = [
		driver.name,
		driver.sort_name,
		driver.first_name,
		driver.last_name,
		driver.nationality,
		...asArray(driver.aliases)
			.filter(value => value !== null && value !== undefined)
			.map(String)
	].filter(Boolean);

	return normalizeString(parts.join(" "));
}

function teamSearchText(team) {
	const parts = [
		team.name,
		team.nationality
	].filter(Boolean);

	return normalizeString(parts.join(" "));
}

function normalizeString(value) {
	return String(value ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");
}

const ESC_MAP = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;"
};

const ESC_REGEX = /[&<>"']/g;

function esc(value) {
	return String(value ?? "").replace(ESC_REGEX, char => ESC_MAP[char]);
}

function safeExternalUrl(value) {
	try {
		const url = new URL(String(value ?? ""), window.location.href);

		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.href;
		}

		return "#";
	} catch {
		return "#";
	}
}

function safeResourceUrl(value) {
	try {
		const url = new URL(String(value ?? ""), window.location.href);

		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.href;
		}

		return "";
	} catch {
		return "";
	}
}

function safeImageUrl(value) {
	try {
		const url = new URL(String(value ?? ""), window.location.href);

		if (url.protocol === "http:" || url.protocol === "https:") {
			return url.href;
		}

		if (url.protocol === "data:") {
			return url.href.startsWith("data:image/") ? url.href : "";
		}

		return "";
	} catch {
		return "";
	}
}

function languageLabel(data, code) {
	if (code === null || code === undefined || code === "") {
		return "—";
	}

	const language = data.languagesByCode[String(code)];

	if (language && language.label) {
		return language.label;
	}

	return String(code).toUpperCase();
}

function driverName(data, driverId) {
	if (driverId === null || driverId === undefined || driverId === "") {
		return "—";
	}

	const driver = data.driversById[String(driverId)];

	return driver?.name || "—";
}

function raceLabel(data, raceId) {
	if (raceId === null || raceId === undefined || raceId === "") {
		return "—";
	}

	const race = data.racesById[String(raceId)];

	if (!race) {
		return String(raceId);
	}

	return `${race.name || ""} ${race.season || ""}`.trim();
}

function emptyHtml(message) {
	return `
		<div class="empty">
			${esc(message)}
		</div>
	`;
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
	const values = (params.get("lang") || "")
		.split(",")
		.map(value => value.trim())
		.filter(Boolean);

	return [...new Set(values)];
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

function route() {
	if (!app) return;

	try {
		closeStatModal();

		const data = state.data;
		if (!data) return;

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
						<h1>Page not found</h1>
						<p>The page you requested does not exist.</p>
						<p>
							<a href="#/">Go home</a> •
							<a href="#/drivers">Drivers</a> •
							<a href="#/teams">Teams</a> •
							<a href="#/races">Races</a> •
							<a href="#/articles">Articles</a>
						</p>
					</div>
				`
			};
		}

		app.innerHTML = page.html;

		if (page.afterRender) {
			Promise.resolve(page.afterRender()).catch(error => {
				console.error(error);
			});
		}

		window.scrollTo({
			top: 0,
			behavior: "auto"
		});
	} catch (error) {
		console.error(error);

		app.innerHTML = `
			<div class="empty">
				Something went wrong while rendering this page.
				Check the browser console for details.
			</div>
		`;
	}
}

function filterByLanguages(articles, selectedLanguages) {
	if (!selectedLanguages.length) {
		return articles;
	}

	return articles.filter(article => selectedLanguages.includes(article.language));
}

function sortArticles(articles, sortDirection) {
	return [...articles].sort((a, b) => {
		const aDate = String(a.published_sort || a.added_at || "");
		const bDate = String(b.published_sort || b.added_at || "");

		if (sortDirection === "desc") {
			return bDate.localeCompare(aDate);
		}

		return aDate.localeCompare(bDate);
	});
}

function getEntityArticles(data, { driverId, raceId, teamId } = {}) {
	const lists = [];

	if (driverId) {
		lists.push(data.articlesByDriver[driverId] || []);
	}

	if (teamId) {
		lists.push(data.articlesByTeam[teamId] || []);
	}

	if (raceId) {
		lists.push(data.articlesByRace[raceId] || []);
	}

	if (!lists.length) {
		return data.articles;
	}

	return lists.reduce((acc, list) => {
		const ids = new Set(list.map(article => article.id));
		return acc.filter(article => ids.has(article.id));
	}, data.articles);
}

function buildTeamParticipationIndex(data) {
	if (caches.teamParticipation) {
		return caches.teamParticipation;
	}

	const index = Object.create(null);
	const raceMaps = Object.create(null);

	data.races.forEach(race => {
		if (race.id === null || race.id === undefined || race.id === "") {
			return;
		}

		const allEntries = [
			...asArray(race.results)
				.filter(isObject)
				.map(entry => ({ ...entry, source: "results" })),
			...asArray(race.qualifying)
				.filter(isObject)
				.map(entry => ({ ...entry, source: "qualifying" })),
			...asArray(race.starting_grid)
				.filter(isObject)
				.map(entry => ({ ...entry, source: "grid" }))
		];

		allEntries.forEach(entry => {
			const teamName = entry.team || entry.constructor || "";
			const teamId = resolveTeamId(data, teamName);

			if (!teamId) return;

			if (!index[teamId]) {
				index[teamId] = [];
				raceMaps[teamId] = Object.create(null);
			}

			let raceEntry = raceMaps[teamId][race.id];

			if (!raceEntry) {
				raceEntry = {
					race,
					results: [],
					qualis: [],
					grids: []
				};

				raceMaps[teamId][race.id] = raceEntry;
				index[teamId].push(raceEntry);
			}

			if (entry.source === "results") {
				raceEntry.results.push(entry);
			} else if (entry.source === "qualifying") {
				raceEntry.qualis.push(entry);
			} else {
				raceEntry.grids.push(entry);
			}
		});
	});

	caches.teamParticipation = index;
	return index;
}

function articleCardHtml(data, article) {
	const driverLinks = uniqueIds(article.driver_ids)
		.map(id => {
			const driver = data.driversById[id];

			if (!driver) {
				return esc(id);
			}

			return `<a href="#/driver/${esc(driver.id)}">${esc(driver.name)}</a>`;
		})
		.filter(Boolean);

	const raceLinks = uniqueIds(article.race_ids)
		.map(id => {
			const race = data.racesById[id];

			if (!race) {
				return esc(id);
			}

			return `<a href="#/race/${esc(race.id)}">${esc(raceLabel(data, id))}</a>`;
		})
		.filter(Boolean);

	const teamLinks = uniqueIds(article.team_ids)
		.map(id => {
			const team = data.teamsById[id];

			if (!team) {
				return esc(id);
			}

			return `<a href="#/team/${esc(team.id)}">${esc(team.name)}</a>`;
		})
		.filter(Boolean);

	const links = [];

	if (article.id && getArticleContentFiles(article).length) {
		links.push(`
			<a href="#/article/${esc(article.id)}">Open article</a>
		`);
	}

	if (article.url) {
		const url = safeExternalUrl(article.url);

		if (url !== "#") {
			links.push(`
				<a href="${esc(url)}" target="_blank" rel="noopener">Read</a>
			`);
		}
	}

	if (article.archive_url) {
		const url = safeExternalUrl(article.archive_url);

		if (url !== "#") {
			links.push(`
				<a href="${esc(url)}" target="_blank" rel="noopener">Archive</a>
			`);
		}
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

			<h3>${esc(article.title || article.id || "Untitled article")}</h3>

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
				driverLinks.length
					? `
						<p>
							<strong>Drivers:</strong>
							${driverLinks.join(", ")}
						</p>
					`
					: ""
			}

			${
				raceLinks.length
					? `
						<p>
							<strong>Races:</strong>
							${raceLinks.join(", ")}
						</p>
					`
					: ""
			}

			${
				teamLinks.length
					? `
						<p>
							<strong>Teams:</strong>
							${teamLinks.join(", ")}
						</p>
					`
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

	const sortedLanguages = [...availableLanguages].sort((a, b) => {
		return languageLabel(data, a).localeCompare(languageLabel(data, b));
	});

	const checkboxes = sortedLanguages
		.map(code => {
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
			<select class="sort-filter" aria-label="Sort articles">
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

function parseWikipediaUrl(url) {
	try {
		const parsed = new URL(url);

		if (!/(^|\.)wikipedia\.org$/i.test(parsed.hostname)) {
			return null;
		}

		const match = parsed.pathname.match(/\/wiki\/([^?#]+)/);

		if (!match) {
			return null;
		}

		let lang = parsed.hostname.split(".")[0] || "en";

		if (
			lang === "www" ||
			lang === "wikipedia" ||
			!/^[a-z]{2,}(-[a-z]+)*$/i.test(lang)
		) {
			lang = "en";
		}

		const title = decodeURIComponent(match[1]);

		if (!title) {
			return null;
		}

		return {
			lang: lang.toLowerCase(),
			title
		};
	} catch {
		return null;
	}
}

function resolveWikiUrl(src, lang) {
	if (!src) {
		return "";
	}

	let url = String(src);

	if (url.startsWith("//")) {
		url = `https:${url}`;
	} else if (url.startsWith("/")) {
		url = `https://${lang}.wikipedia.org${url}`;
	}

	return safeImageUrl(url);
}

async function fetchWikiMediaImage(lang, title) {
	if (!title) {
		return "";
	}

	try {
		const response = await fetch(
			`https://${lang}.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title)}`
		);

		if (!response.ok) {
			return "";
		}

		const data = await response.json();
		const items = Array.isArray(data.items)
			? data.items.filter(isObject)
			: [];

		const imageItems = items.filter(
			item => item.type === "image" && Array.isArray(item.srcset)
		);

		const preferred = imageItems.filter(item => item.section_id === 0);

		for (const list of [preferred, imageItems]) {
			for (const item of list) {
				const entry = [...item.srcset]
					.reverse()
					.find(candidate => candidate && candidate.src);

				if (entry) {
					return resolveWikiUrl(entry.src, lang);
				}
			}
		}

		return "";
	} catch {
		return "";
	}
}

async function fetchWikiSummary(lang, title) {
	if (!title) {
		return null;
	}

	const cacheKey = `${lang}:${title}`;

	if (caches.wikiSummary.has(cacheKey)) {
		return caches.wikiSummary.get(cacheKey);
	}

	const storageKey = `wiki-summary:v3:${cacheKey}`;

	try {
		const stored = localStorage.getItem(storageKey);

		if (stored) {
			const parsed = JSON.parse(stored);

			if (
				parsed &&
				parsed.timestamp &&
				Date.now() - parsed.timestamp < 7 * 24 * 60 * 60 * 1000
			) {
				caches.wikiSummary.set(cacheKey, parsed.data);
				return parsed.data;
			}
		}
	} catch {
		// Ignore storage errors.
	}

	try {
		const response = await fetch(
			`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
		);

		if (!response.ok) {
			return null;
		}

		const data = await response.json();

		if (!data || data.type === "disambiguation") {
			return null;
		}

		const summary = {
			extract: data.extract || "",
			image: resolveWikiUrl(data.thumbnail ? data.thumbnail.source : "", lang)
		};

		if (!summary.image) {
			summary.image = await fetchWikiMediaImage(lang, title);
		}

		caches.wikiSummary.set(cacheKey, summary);

		try {
			localStorage.setItem(
				storageKey,
				JSON.stringify({
					timestamp: Date.now(),
					data: summary
				})
			);
		} catch {
			// Ignore storage errors.
		}

		return summary;
	} catch {
		return null;
	}
}

async function loadWikiIntro(wikipediaUrl, altText) {
	const container = document.getElementById("wiki-intro");

	if (!container) {
		return;
	}

	const requestId = ++wikiIntroRequestId;

	if (!wikipediaUrl) {
		container.innerHTML = "";
		return;
	}

	const parsed = parseWikipediaUrl(wikipediaUrl);

	if (!parsed) {
		container.innerHTML = "";
		return;
	}

	container.innerHTML = `
		<p class="muted" style="padding:0.5rem 0">Loading intro…</p>
	`;

	const summary = await fetchWikiSummary(parsed.lang, parsed.title);

	if (requestId !== wikiIntroRequestId) {
		return;
	}

	const imageUrl = summary ? safeImageUrl(summary.image) : "";

	if (!summary || (!summary.extract && !imageUrl)) {
		container.innerHTML = "";
		return;
	}

	const safeWikipediaUrl = safeExternalUrl(wikipediaUrl);

	const wikipediaLinkHtml = safeWikipediaUrl !== "#"
		? `
			<a href="${esc(safeWikipediaUrl)}" target="_blank" rel="noopener">
				Wikipedia
			</a>
		`
		: "Wikipedia";

	container.innerHTML = `
		<div class="wiki-intro card">
			${
				imageUrl
					? `
						<img
							class="wiki-intro-image"
							src="${esc(imageUrl)}"
							alt="${esc(altText || "")}"
							loading="lazy"
						>
					`
					: ""
			}
			<div class="wiki-intro-text">
				${summary.extract ? `<p>${esc(summary.extract)}</p>` : ""}
				<p class="muted wiki-intro-source">
					From ${wikipediaLinkHtml} (CC BY-SA)
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

	const pastRaces = data.races.filter(race => {
		return race.date && race.date <= today;
	});

	const latestRaces = [...(pastRaces.length ? pastRaces : data.races)]
		.sort((a, b) => {
			return (
				String(b.date || "").localeCompare(String(a.date || "")) ||
				(Number(b.season) || 0) - (Number(a.season) || 0) ||
				(Number(b.round) || 0) - (Number(a.round) || 0)
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
								.map(article => articleCardHtml(data, article))
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
									.map(driver => `
										<a class="list-item" href="#/driver/${esc(driver.id)}">
											<span>${esc(driver.name || driver.id)}</span>
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
									.map(race => {
										const metaParts = [race.country, race.date]
											.filter(Boolean)
											.map(esc);

										return `
											<a class="list-item" href="#/race/${esc(race.id)}">
												<span>${esc(race.name || race.id)} ${esc(race.season || "")}</span>
												<span class="muted">
													${metaParts.join(" • ")}
												</span>
											</a>
										`;
									})
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

function debounce(fn, delay) {
	let timer;

	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), delay);
	};
}

function renderDrivers(data) {
	const query = uiState.driverSearch;
	const filtered = filterDrivers(data.drivers, query);

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
			aria-label="Search drivers"
			autocomplete="off"
			value="${esc(query)}"
		>

		<p id="driver-search-status" class="muted" role="status">
			${filtered.length} driver${filtered.length === 1 ? "" : "s"}
		</p>

		<div id="driver-list" class="driver-grid" aria-live="polite">
			${driverCardsHtml(data, filtered, query)}
		</div>
	`;

	function afterRender() {
		const input = document.getElementById("driver-search");
		const list = document.getElementById("driver-list");
		const status = document.getElementById("driver-search-status");

		const update = debounce(() => {
			uiState.driverSearch = input.value;

			const nextFiltered = filterDrivers(data.drivers, input.value);

			list.innerHTML = driverCardsHtml(data, nextFiltered, input.value);

			if (status) {
				status.textContent = `${nextFiltered.length} driver${nextFiltered.length === 1 ? "" : "s"}`;
			}
		}, 200);

		input.addEventListener("input", update);
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
		.filter(driver => {
			const searchText = driver._searchText ?? driverSearchText(driver);
			return searchText.includes(q);
		})
		.sort((a, b) => {
			return String(a.sort_name || a.name || "").localeCompare(
				String(b.sort_name || b.name || "")
			);
		});
}

function driverCardsHtml(data, drivers, query = "") {
	if (!drivers.length) {
		return emptyHtml(
			query
				? `No drivers found for “${query}”.`
				: "No drivers found."
		);
	}

	return drivers
		.map(driver => `
			<a class="card driver-card" href="#/driver/${esc(driver.id)}">
				<h3>${esc(driver.name || driver.id)}</h3>
				<p class="muted">
					${esc(driver.nationality || "")}
					${
						driver.active_years
							? ` • ${esc(formatActiveYears(driver.active_years))}`
							: ""
					}
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

	const decades = Object.create(null);

	data.races.forEach(race => {
		const season = Number(race.season);

		if (Number.isFinite(season) && season > 0) {
			const decade = Math.floor(season / 10) * 10;
			const decadeKey = String(decade);
			const decadeLabel = `${decade}s`;
			const yearKey = String(season);

			if (!decades[decadeKey]) {
				decades[decadeKey] = {
					label: decadeLabel,
					sort: decade,
					years: Object.create(null)
				};
			}

			if (!decades[decadeKey].years[yearKey]) {
				decades[decadeKey].years[yearKey] = [];
			}

			decades[decadeKey].years[yearKey].push(race);
		} else {
			if (!decades.unknown) {
				decades.unknown = {
					label: "Unknown season",
					sort: -Infinity,
					years: Object.create(null)
				};
			}

			if (!decades.unknown.years.unknown) {
				decades.unknown.years.unknown = [];
			}

			decades.unknown.years.unknown.push(race);
		}
	});

	const sortedDecadeKeys = Object.keys(decades).sort((a, b) => {
		const sortA = decades[a].sort;
		const sortB = decades[b].sort;

		if (sortA === sortB) return 0;
		if (sortA === -Infinity) return 1;
		if (sortB === -Infinity) return -1;

		return sortB - sortA;
	});

	if (!sortedDecadeKeys.length) {
		return {
			html: `
				<section class="page-head">
					<h1>Races</h1>
				</section>
				${emptyHtml("No valid race seasons found.")}
			`
		};
	}

	let decadesHtml = "";

	sortedDecadeKeys.forEach(decadeKey => {
		const decade = decades[decadeKey];

		const sortedYearKeys = Object.keys(decade.years).sort((a, b) => {
			if (a === "unknown") return 1;
			if (b === "unknown") return -1;
			return Number(b) - Number(a);
		});

		let yearsHtml = "";

		sortedYearKeys.forEach((yearKey, yearIndex) => {
			const races = decade.years[yearKey].sort((a, b) => {
				const aRound = Number(a.round);
				const bRound = Number(b.round);

				const aSort = Number.isFinite(aRound) && aRound > 0 ? aRound : 9999;
				const bSort = Number.isFinite(bRound) && bRound > 0 ? bRound : 9999;

				return aSort - bSort;
			});

			const racesHtml = races
				.map(race => {
					const round = Number(race.round);

					const roundLabel = Number.isFinite(round) && round > 0
						? `R${String(round).padStart(2, "0")}`
						: "";

					const metaParts = [race.country, race.date]
						.filter(Boolean)
						.map(esc);

					return `
						<li class="race-item">
							<a href="#/race/${esc(race.id)}">
								<span class="race-name">
									${
										roundLabel
											? `<span class="race-round">${esc(roundLabel)}</span>`
											: ""
									}
									${esc(race.name || race.id)}
								</span>
								<span class="muted race-meta">
									${metaParts.join(" • ")}
								</span>
							</a>
						</li>
					`;
				})
				.join("");

			const isOpen = yearIndex === 0 && decadeKey === sortedDecadeKeys[0];
			const yearLabel = yearKey === "unknown" ? "Unknown" : yearKey;

			yearsHtml += `
				<details class="year-group" ${isOpen ? "open" : ""}>
					<summary class="year-summary">
						<span>${esc(yearLabel)} Season</span>
						<span class="muted" style="font-size:0.85rem; margin-right:1rem;">
							${races.length} race${races.length === 1 ? "" : "s"}
						</span>
					</summary>
					<ul class="races-list">
						${racesHtml}
					</ul>
				</details>
			`;
		});

		const isDecadeOpen = decadeKey === sortedDecadeKeys[0];

		decadesHtml += `
			<details class="decade-group" ${isDecadeOpen ? "open" : ""}>
				<summary class="decade-summary">
					<span>${esc(decade.label)}</span>
					<span style="font-size:0.85rem; font-weight:normal; opacity:0.8;">
						${Object.keys(decade.years).length} season${Object.keys(decade.years).length === 1 ? "" : "s"}
					</span>
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

	return {
		html
	};
}

function driverStatButton(driverId, stat, label) {
	return `
		<button
			type="button"
			class="stat-link"
			data-stat="${esc(stat)}"
			data-driver="${esc(driverId)}"
		>
			${esc(label)}
		</button>
	`;
}

function teamStatButton(teamId, stat, label) {
	return `
		<button
			type="button"
			class="stat-link team-stat-link"
			data-stat="${esc(stat)}"
			data-team="${esc(teamId)}"
		>
			${esc(label)}
		</button>
	`;
}

function renderDriverPage(data, driverId, params) {
	const driver = data.driversById[driverId];

	if (!driver) {
		return {
			html: emptyHtml("Driver not found.")
		};
	}

	const entityArticles = getEntityArticles(data, { driverId });

	const availableLanguages = [...new Set(
		entityArticles
			.map(article => article.language)
			.filter(Boolean)
	)].sort();

	const selectedLanguages = getSelectedLanguages(params)
		.filter(code => availableLanguages.includes(code));

	const sort = getSort(params);

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles
				.map(article => articleCardHtml(data, article))
				.join("")
		: emptyHtml(
				entityArticles.length
					? "No articles match these filters."
					: "No articles archived yet."
			);

	const stats = getDriverStats(data, driver.id);
	const statRows = [];

	statRows.push(`
		<dt>Active years</dt>
		<dd>
			${driverStatButton(driver.id, "races", formatActiveYears(driver.active_years))}
		</dd>
	`);

	if (stats.wins > 0) {
		statRows.push(`
			<dt>Wins</dt>
			<dd>
				${driverStatButton(driver.id, "wins", stats.wins)}
			</dd>
		`);
	}

	if (stats.podiums > 0) {
		statRows.push(`
			<dt>Podiums</dt>
			<dd>
				${driverStatButton(driver.id, "podiums", stats.podiums)}
			</dd>
		`);
	} else if (stats.bestFinish !== null) {
		statRows.push(`
			<dt>Best finish</dt>
			<dd>
				${driverStatButton(
					driver.id,
					"best-finish",
					`${stats.bestFinish}${getOrdinal(stats.bestFinish)}`
				)}
			</dd>
		`);
	}

	if (stats.poles > 0) {
		statRows.push(`
			<dt>Pole positions</dt>
			<dd>
				${driverStatButton(driver.id, "poles", stats.poles)}
			</dd>
		`);
	} else if (stats.bestGrid !== null) {
		statRows.push(`
			<dt>Best grid</dt>
			<dd>
				${driverStatButton(
					driver.id,
					"best-grid",
					`${stats.bestGrid}${getOrdinal(stats.bestGrid)}`
				)}
			</dd>
		`);
	}

	if (stats.fastestLaps > 0) {
		statRows.push(`
			<dt>Fastest laps</dt>
			<dd>
				${driverStatButton(driver.id, "fastest-laps", stats.fastestLaps)}
			</dd>
		`);
	}

	const hasChampionshipData =
		asArray(driver.championship_results).filter(isObject).length > 0;

	if (stats.bestChampFinish !== null) {
		statRows.push(`
			<dt>Best championship</dt>
			<dd>
				${driverStatButton(
					driver.id,
					"best-champ",
					`${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)}`
				)}
			</dd>
		`);
	} else if (hasChampionshipData) {
		statRows.push(`
			<dt>Best championship</dt>
			<dd>
				${driverStatButton(driver.id, "best-champ", "Not classified")}
			</dd>
		`);
	}

	const driverTeams = [];
	const seenDriverTeamKeys = new Set();

	asArray(driver.teams)
		.filter(teamName => {
			return teamName !== null &&
				teamName !== undefined &&
				(typeof teamName === "string" || typeof teamName === "number") &&
				String(teamName).trim() !== "";
		})
		.forEach(teamName => {
			const teamId = resolveTeamId(data, teamName);
			const team = teamId ? data.teamsById[teamId] : null;
			const key = team ? team.id : normalizeTeamKey(teamName);

			if (!key || seenDriverTeamKeys.has(key)) {
				return;
			}

			seenDriverTeamKeys.add(key);

			driverTeams.push({
				label: team ? team.name : String(teamName),
				html: team
					? `<a href="#/team/${esc(team.id)}">${esc(team.name)}</a>`
					: esc(teamName)
			});
		});

	driverTeams.sort((a, b) => a.label.localeCompare(b.label));

	const driverTeamLinks = driverTeams.map(team => team.html);

	const driverWikipediaUrl = driver.wikipedia_url
		? safeExternalUrl(driver.wikipedia_url)
		: "#";

	const hasWikipedia =
		driverWikipediaUrl !== "#" &&
		Boolean(parseWikipediaUrl(driver.wikipedia_url));

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

					${statRows.join("")}

					<dt>Teams</dt>
					<dd>
						${driverTeamLinks.length ? driverTeamLinks.join(", ") : "—"}
					</dd>
				</dl>

				${
					hasWikipedia
						? `
							<p>
								<a href="${esc(driverWikipediaUrl)}" target="_blank" rel="noopener">
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
			<h1>${esc(driver.name || driver.id)}</h1>
			<p class="muted">
				${esc(driver.nationality || "")}
				${
					driver.active_years
						? ` • ${esc(formatActiveYears(driver.active_years))}`
						: ""
				}
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
			loadWikiIntro(driver.wikipedia_url, driver.name || driver.id);
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

	const availableLanguages = [...new Set(
		entityArticles
			.map(article => article.language)
			.filter(Boolean)
	)].sort();

	const selectedLanguages = getSelectedLanguages(params)
		.filter(code => availableLanguages.includes(code));

	const sort = getSort(params);

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles
				.map(article => articleCardHtml(data, article))
				.join("")
		: emptyHtml(
				entityArticles.length
					? "No articles match these filters."
					: "No articles archived yet."
			);

	const resultsHtml = raceTabsHtml(data, race);

	const raceWikipediaUrl = race.wikipedia_url
		? safeExternalUrl(race.wikipedia_url)
		: "#";

	const hasWikipedia =
		raceWikipediaUrl !== "#" &&
		Boolean(parseWikipediaUrl(race.wikipedia_url));

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
					<dd>${teamLinkHtml(data, race.winning_team)}</dd>

					<dt>Pole position</dt>
					<dd>${esc(driverName(data, race.pole_driver_id))}</dd>

					<dt>Fastest lap</dt>
					<dd>${esc(driverName(data, race.fastest_lap_driver_id))}</dd>
				</dl>

				${
					hasWikipedia
						? `
							<p>
								<a href="${esc(raceWikipediaUrl)}" target="_blank" rel="noopener">
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
			<h1>${esc(`${race.season || ""} ${race.name || ""}`.trim() || race.id)}</h1>
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

	const availableLanguages = [...new Set(
		allArticles
			.map(article => article.language)
			.filter(Boolean)
	)].sort();

	const selectedLanguages = getSelectedLanguages(params)
		.filter(code => availableLanguages.includes(code));

	const sort = getSort(params);

	const filteredArticles = sortArticles(
		filterByLanguages(allArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles
				.map(article => articleCardHtml(data, article))
				.join("")
		: emptyHtml(
				allArticles.length
					? "No articles match these filters."
					: "No articles archived yet."
			);

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

function normalizeContentFile(file, index) {
	if (!file) {
		return null;
	}

	if (typeof file === "string") {
		return {
			type: "inline_text",
			label: `Content ${index + 1}`,
			body: file
		};
	}

	if (!isObject(file)) {
		return null;
	}

	const normalized = { ...file };

	const src = normalized.src || normalized.path || normalized.url;

	if (src) {
		normalized.src = src;
	}

	if (!normalized.type && normalized.body !== null && normalized.body !== undefined) {
		normalized.type = "inline_text";
	}

	if (!normalized.type && normalized.src) {
		const extension = String(normalized.src)
			.split(".")
			.pop()
			.toLowerCase();

		if (extension === "md" || extension === "markdown") {
			normalized.type = "markdown";
		} else if (extension === "html" || extension === "htm") {
			normalized.type = "html";
		} else if (extension === "pdf") {
			normalized.type = "pdf";
		} else if (extension === "txt") {
			normalized.type = "text";
		}
	}

	if (
		normalized.pages !== null &&
		normalized.pages !== undefined &&
		!Array.isArray(normalized.pages)
	) {
		normalized.pages = [normalized.pages];
	}

	return normalized;
}

function getArticleContentFiles(article) {
	if (Array.isArray(article.content_files) && article.content_files.length > 0) {
		return article.content_files
			.map((file, index) => normalizeContentFile(file, index))
			.filter(Boolean);
	}

	if (isObject(article.content_files)) {
		const normalized = normalizeContentFile(article.content_files, 0);
		return normalized ? [normalized] : [];
	}

	if (article.content !== null && article.content !== undefined) {
		if (typeof article.content === "string" && article.content.trim() === "") {
			return [];
		}

		if (Array.isArray(article.content)) {
			return article.content
				.map((file, index) => normalizeContentFile(file, index))
				.filter(Boolean);
		}

		const normalized = normalizeContentFile(article.content, 0);
		return normalized ? [normalized] : [];
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
	try {
		if (
			window.marked &&
			window.DOMPurify &&
			typeof window.DOMPurify.sanitize === "function"
		) {
			return DOMPurify.sanitize(marked.parse(markdown));
		}
	} catch (error) {
		console.error(error);
	}

	return `
		<pre class="article-text">${esc(markdown)}</pre>
	`;
}

function sanitizeHtml(html) {
	try {
		if (
			window.DOMPurify &&
			typeof window.DOMPurify.sanitize === "function"
		) {
			return DOMPurify.sanitize(html);
		}
	} catch (error) {
		console.error(error);
	}

	return `
		<pre class="article-text">${esc(html)}</pre>
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

	const requestId = ++articleContentRequestId;

	container.innerHTML = `
		<div class="empty">
			Loading content…
		</div>
	`;

	try {
		const type = String(file.type || "").toLowerCase();

		if (type === "inline_text") {
			if (requestId !== articleContentRequestId) return;

			container.innerHTML = `
				<pre class="article-text">${esc(file.body || "")}</pre>
			`;
			return;
		}

		if (type === "inline_markdown") {
			if (requestId !== articleContentRequestId) return;

			container.innerHTML = renderMarkdown(file.body || "");
			return;
		}

		const src = safeResourceUrl(file.src);

		if (!src) {
			throw new Error(`Unsafe or invalid content src: ${file.src}`);
		}

		if (type === "text" || type === "txt") {
			const text = await fetch(src).then(checkTextResponse);

			if (requestId !== articleContentRequestId) return;

			container.innerHTML = `
				<pre class="article-text">${esc(text)}</pre>
			`;
		} else if (type === "markdown" || type === "md") {
			const markdown = await fetch(src).then(checkTextResponse);

			if (requestId !== articleContentRequestId) return;

			container.innerHTML = renderMarkdown(markdown);
		} else if (type === "html" || type === "htm") {
			const html = await fetch(src).then(checkTextResponse);

			if (requestId !== articleContentRequestId) return;

			container.innerHTML = sanitizeHtml(html);
		} else if (type === "pdf") {
			if (requestId !== articleContentRequestId) return;

			container.innerHTML = `
				<div class="pdf-wrap">
					<iframe
						src="${esc(src)}"
						title="${esc(article.title || article.id || "Article")}"
						loading="lazy"
						sandbox="allow-same-origin allow-popups"
					></iframe>
					<p>
						<a href="${esc(src)}" target="_blank" rel="noopener">
							Open PDF in new tab
						</a>
					</p>
				</div>
			`;
		} else if (type === "scan") {
			const pages = asArray(file.pages)
				.map(pageSrc => safeImageUrl(pageSrc))
				.filter(Boolean);

			if (!pages.length) {
				throw new Error("Scan content has no valid pages.");
			}

			if (requestId !== articleContentRequestId) return;

			container.innerHTML = `
				<div class="scan-pages">
					${
						pages
							.map((pageSrc, index) => `
								<figure class="scan-page">
									<img
										loading="lazy"
										src="${esc(pageSrc)}"
										alt="Page ${index + 1} of ${esc(article.title || article.id || "Article")}"
									>
									<figcaption>Page ${index + 1}</figcaption>
								</figure>
							`)
							.join("")
					}
				</div>
			`;
		} else {
			if (requestId !== articleContentRequestId) return;

			container.innerHTML = emptyHtml(
				`Unsupported content type: ${file.type || "unknown"}`
			);
		}
	} catch (error) {
		console.error(error);

		if (requestId !== articleContentRequestId) return;

		container.innerHTML = emptyHtml(
			"Could not load article content. Check the file path and JSON data."
		);
	}
}

function renderArticlePage(data, articleId) {
	const article = data.articlesById[articleId];

	if (!article) {
		return {
			html: emptyHtml("Article not found.")
		};
	}

	const files = getArticleContentFiles(article);

	const driverLinks = uniqueIds(article.driver_ids)
		.map(id => {
			const driver = data.driversById[id];

			if (!driver) {
				return esc(id);
			}

			return `
				<a href="#/driver/${esc(driver.id)}">
					${esc(driver.name)}
				</a>
			`;
		})
		.filter(Boolean);

	const teamLinks = uniqueIds(article.team_ids)
		.map(id => {
			const team = data.teamsById[id];

			if (!team) {
				return esc(id);
			}

			return `
				<a href="#/team/${esc(team.id)}">
					${esc(team.name)}
				</a>
			`;
		})
		.filter(Boolean);

	const raceLinks = uniqueIds(article.race_ids)
		.map(id => {
			const race = data.racesById[id];

			if (!race) {
				return esc(id);
			}

			return `
				<a href="#/race/${esc(race.id)}">
					${esc(race.name || "")} ${esc(race.season || "")}
				</a>
			`;
		})
		.filter(Boolean);

	const fileSelectorHtml = files.length > 1
		? `
			<div class="toolbar">
				<div class="filters">
					<span class="filters-label">View:</span>
					<select id="article-file-select" class="sort-filter" aria-label="Select article file">
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

	const originalUrl = article.url
		? safeExternalUrl(article.url)
		: "#";

	const archiveUrl = article.archive_url
		? safeExternalUrl(article.archive_url)
		: "#";

	const html = `
		<section class="page-head">
			<p>
				<a href="#/articles">← All articles</a>
			</p>
			<h1>${esc(article.title || article.id || "Article")}</h1>
			<p class="muted">
				${esc(article.article_type || "article")}
				${
					article.language
						? ` • ${esc(languageLabel(data, article.language))}`
						: ""
				}
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
							${
								article.language
									? esc(languageLabel(data, article.language))
									: "—"
							}
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
						originalUrl !== "#"
							? `
								<p>
									<a href="${esc(originalUrl)}" target="_blank" rel="noopener">
										Original URL
									</a>
								</p>
							`
							: ""
					}

					${
						archiveUrl !== "#"
							? `
								<p>
									<a href="${esc(archiveUrl)}" target="_blank" rel="noopener">
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

function parseGridValue(value) {
	if (value === null || value === undefined || value === "") {
		return NaN;
	}

	const text = String(value).trim().toUpperCase();

	if (text === "PL") {
		return 0;
	}

	const parsed = parseInt(value, 10);

	if (!Number.isFinite(parsed) || parsed < 0) {
		return NaN;
	}

	return parsed;
}

function gridSortValue(grid) {
	if (!Number.isFinite(grid) || grid <= 0) {
		return 9999;
	}

	return grid;
}

function parsePositionValue(value) {
	const parsed = parseInt(value, 10);

	if (!Number.isFinite(parsed) || parsed <= 0) {
		return NaN;
	}

	return parsed;
}

function positionSortValue(value) {
	const parsed = parsePositionValue(value);

	return Number.isFinite(parsed) ? parsed : 9999;
}

function firstValidPosition(...values) {
	for (const value of values) {
		const parsed = parsePositionValue(value);

		if (Number.isFinite(parsed)) {
			return parsed;
		}
	}

	return NaN;
}

function qualifyingPositionDisplay(value) {
	const parsed = parsePositionValue(value);

	if (Number.isFinite(parsed)) {
		return esc(parsed);
	}

	if (
		value === null ||
		value === undefined ||
		value === "" ||
		String(value).trim() === "0"
	) {
		return "—";
	}

	return esc(value);
}

function getStartingGridRows(race) {
	const rows = [];

	const gridArray = asArray(race.starting_grid).filter(isObject);

	if (gridArray.length) {
		rows.push(...gridArray);
	} else {
		const results = asArray(race.results).filter(isObject);

		for (const result of results) {
			const grid = parseGridValue(result.grid);

			if (Number.isFinite(grid) && grid >= 0) {
				rows.push({
					grid,
					driver_id: result.driver_id,
					driver_name: result.driver_name || "",
					team: result.team || result.constructor || ""
				});
			}
		}
	}

	return rows.sort((a, b) => {
		const aGrid = parseGridValue(a.grid);
		const bGrid = parseGridValue(b.grid);

		return gridSortValue(aGrid) - gridSortValue(bGrid);
	});
}

function positionDeltaHtml(result) {
	const pos = firstValidPosition(result.position, result.positionText);
	const grid = parseGridValue(result.grid);

	if (!Number.isFinite(pos) || !Number.isFinite(grid) || grid <= 0) {
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
	const results = asArray(race.results).filter(isObject);

	if (!results.length) {
		return emptyHtml("No results stored yet.");
	}

	const rows = [...results]
		.sort((a, b) => {
			return positionSortValue(a.position || a.positionText) -
				positionSortValue(b.position || b.positionText);
		})
		.map(result => {
			const driver = result.driver_id
				? data.driversById[String(result.driver_id)]
				: null;

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(result.driver_name || result.driver_id || "—");

			const posNumber = firstValidPosition(result.position, result.positionText);

			const posDisplay = Number.isFinite(posNumber)
				? String(posNumber)
				: (result.positionText || "—");

			return `
				<tr>
					<td>${esc(posDisplay)}</td>
					<td>${positionDeltaHtml(result)}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, result.team || result.constructor)}</td>
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
	const qualifying = asArray(race.qualifying).filter(isObject);

	if (!qualifying.length) {
		return emptyHtml("No qualifying data stored yet.");
	}

	const hasQ1 = qualifying.some(
		r => r.q1 && r.q1 !== "—" && r.q1 !== "-" && r.q1 !== "" && r.q1 !== "no time"
	);

	const hasQ2 = qualifying.some(
		r => r.q2 && r.q2 !== "—" && r.q2 !== "-" && r.q2 !== "" && r.q2 !== "no time"
	);

	const hasQ3 = qualifying.some(
		r => r.q3 && r.q3 !== "—" && r.q3 !== "-" && r.q3 !== "" && r.q3 !== "no time"
	);
	
	const hasQ4 = qualifying.some(
		r => r.q4 && r.q4 !== "—" && r.q4 !== "-" && r.q4 !== "" && r.q4 !== "no time"
	);

	const showSingleTime = !hasQ1 && !hasQ2 && !hasQ3;

	let headerCols = `
		<th>Pos</th>
		<th>Driver</th>
		<th>Constructor</th>
	`;

	if (showSingleTime) {
		headerCols += `<th>Time</th>`;
	} else {
		if (hasQ1) headerCols += `<th>Q1</th>`;
		if (hasQ2) headerCols += `<th>Q2</th>`;
		if (hasQ3) headerCols += `<th>Q3</th>`;
		if (hasQ4) headerCols += `<th>Q4</th>`;
	}

	const rows = [...qualifying]
		.sort((a, b) => positionSortValue(a.position) - positionSortValue(b.position))
		.map(q => {
			const driver = q.driver_id
				? data.driversById[String(q.driver_id)]
				: null;

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(q.driver_name || q.driver_id || "—");

			let timeCols = "";

			if (showSingleTime) {
				const time =
					(q.q1 && q.q1 !== "no time" ? q.q1 : "") ||
					(q.q2 && q.q2 !== "no time" ? q.q2 : "") ||
					(q.q3 && q.q3 !== "no time" ? q.q3 : "") ||
					(q.q4 && q.q4 !== "no time" ? q.q4 : "") ||
					"—";

				timeCols = `<td>${esc(time)}</td>`;
			} else {
				if (hasQ1) {
					timeCols += `<td>${esc(q.q1 && q.q1 !== "no time" ? q.q1 : "—")}</td>`;
				}

				if (hasQ2) {
					timeCols += `<td>${esc(q.q2 && q.q2 !== "no time" ? q.q2 : "—")}</td>`;
				}

				if (hasQ3) {
					timeCols += `<td>${esc(q.q3 && q.q3 !== "no time" ? q.q3 : "—")}</td>`;
				}
				if (hasQ4) {
					timeCols += `<td>${esc(q.q4 && q.q4 !== "no time" ? q.q4 : "—")}</td>`;
				}
			}

			return `
				<tr>
					<td>${qualifyingPositionDisplay(q.position)}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, q.team || q.constructor)}</td>
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
		.map(row => {
			const driver = row.driver_id
				? data.driversById[String(row.driver_id)]
				: null;

			const driverHtml = driver
				? `
					<a href="#/driver/${esc(driver.id)}">
						${esc(driver.name)}
					</a>
				`
				: esc(row.driver_name || row.driver_id || "—");

			const gridValue = parseGridValue(row.grid);

			const gridDisplay = !Number.isFinite(gridValue)
				? "—"
				: gridValue === 0
					? "PL"
					: esc(gridValue);

			return `
				<tr>
					<td>${gridDisplay}</td>
					<td>${driverHtml}</td>
					<td>${teamLinkHtml(data, row.team || row.constructor)}</td>
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
	const hasResults = asArray(race.results).filter(isObject).length > 0;
	const hasQualifying = asArray(race.qualifying).filter(isObject).length > 0;
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

			<div class="tab-panel hidden" data-race-tab-panel="qualifying" hidden>
				${
					hasQualifying
						? raceQualifyingTableHtml(data, race)
						: emptyHtml("No qualifying data stored yet.")
				}
			</div>

			<div class="tab-panel hidden" data-race-tab-panel="grid" hidden>
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

	buttons.forEach(button => {
		button.addEventListener("click", () => {
			const card = button.closest(".race-tabs-card");

			if (!card) {
				return;
			}

			const target = button.dataset.raceTab;

			card.querySelectorAll("[data-race-tab]").forEach(tabButton => {
				tabButton.classList.toggle("active", tabButton === button);
			});

			card.querySelectorAll("[data-race-tab-panel]").forEach(panel => {
				const show = panel.dataset.raceTabPanel === target;

				panel.hidden = !show;
				panel.classList.toggle("hidden", !show);
			});
		});
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
	const map = Object.create(null);

	teams.forEach(team => {
		const key = normalizeTeamKey(team.name);

		if (!key || team.id === null || team.id === undefined || team.id === "") {
			return;
		}

		if (!map[key]) {
			map[key] = String(team.id);
		} else {
			console.warn(`Duplicate normalized team name: ${team.name}`);
		}
	});

	return map;
}

const teamIdCache = {}; 

function findTeamIdByName(data, teamName) {
    if (!teamName || !data.teamsByName) return null;
    const cacheKey = teamName;
    if (teamIdCache[cacheKey] !== undefined) return teamIdCache[cacheKey];
    
    const norm = normalizeTeamKey(teamName);
    if (!norm || norm === "—") {
        teamIdCache[cacheKey] = null;
        return null;
    }
    
    // Exact canonical match
    if (TEAM_CANONICAL_BY_NAME[norm]) {
        teamIdCache[cacheKey] = TEAM_CANONICAL_BY_NAME[norm];
        return teamIdCache[cacheKey];
    }
    
    // Exact dictionary match
    if (data.teamsByName[norm]) {
        teamIdCache[cacheKey] = data.teamsByName[norm];
        return teamIdCache[cacheKey];
    }
    
    // Match individual parts
    const parts = norm.split(/[-–—/\s]/).map(p => p.trim()).filter(Boolean);
    for (const part of parts) {
        if (TEAM_CANONICAL_BY_NAME[part]) {
            teamIdCache[cacheKey] = TEAM_CANONICAL_BY_NAME[part];
            return teamIdCache[cacheKey];
        }
        if (data.teamsByName[part]) {
            teamIdCache[cacheKey] = data.teamsByName[part];
            return teamIdCache[cacheKey];
        }
    }
    
    // Regex Fallback (Word Boundaries)
    let bestId = null;
    let bestLength = 0;
    for (const [name, id] of Object.entries(data.teamsByName)) {
        if (name.length >= 3) {
            // Escape regex special characters in the team name
            const escapedName = name.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
            
            // \b ensures we only match whole words/parts. 
            // "maserati" will NO LONGER match "era".
            const regex = new RegExp(`\\b${escapedName}\\b`);
            
            if (regex.test(norm) && name.length > bestLength) {
                bestLength = name.length;
                bestId = id;
            }
        }
    }
    
    teamIdCache[cacheKey] = bestId;
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

	const team = data.teamsById[teamId];

	if (!team) {
		return esc(teamName);
	}

	return `
		<a href="#/team/${esc(teamId)}">
			${esc(team.name)}
		</a>
	`;
}

function filterTeams(teams, query) {
	const q = normalizeString(query);

	if (!q) {
		return teams;
	}

	return teams
		.filter(team => {
			const searchText = team._searchText ?? teamSearchText(team);
			return searchText.includes(q);
		})
		.sort((a, b) => {
			return String(a.name || "").localeCompare(String(b.name || ""));
		});
}

function teamCardsHtml(data, teams, query = "") {
	if (!teams.length) {
		return emptyHtml(
			query
				? `No teams found for “${query}”.`
				: "No teams found."
		);
	}

	return teams
		.map(team => `
			<a class="card driver-card" href="#/team/${esc(team.id)}">
				<h3>${esc(team.name || team.id)}</h3>
				<p class="muted">
					${esc(team.nationality || "")}
					${
						team.active_years
							? ` • ${esc(formatActiveYears(team.active_years))}`
							: ""
					}
				</p>
				<p class="muted">
					${team.wins ?? 0} wins • ${team.pole_positions ?? 0} poles
				</p>
			</a>
		`)
		.join("");
}

function renderTeams(data) {
	const query = uiState.teamSearch;
	const filtered = filterTeams(data.teams, query);

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
			aria-label="Search teams"
			autocomplete="off"
			value="${esc(query)}"
		>

		<p id="team-search-status" class="muted" role="status">
			${filtered.length} team${filtered.length === 1 ? "" : "s"}
		</p>

		<div id="team-list" class="driver-grid" aria-live="polite">
			${teamCardsHtml(data, filtered, query)}
		</div>
	`;

	function afterRender() {
		const input = document.getElementById("team-search");
		const list = document.getElementById("team-list");
		const status = document.getElementById("team-search-status");

		const update = debounce(() => {
			uiState.teamSearch = input.value;

			const nextFiltered = filterTeams(data.teams, input.value);

			list.innerHTML = teamCardsHtml(data, nextFiltered, input.value);

			if (status) {
				status.textContent = `${nextFiltered.length} team${nextFiltered.length === 1 ? "" : "s"}`;
			}
		}, 200);

		input.addEventListener("input", update);
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

	const availableLanguages = [...new Set(
		entityArticles
			.map(article => article.language)
			.filter(Boolean)
	)].sort();

	const selectedLanguages = getSelectedLanguages(params)
		.filter(code => availableLanguages.includes(code));

	const sort = getSort(params);

	const filteredArticles = sortArticles(
		filterByLanguages(entityArticles, selectedLanguages),
		sort
	);

	const articlesHtml = filteredArticles.length
		? filteredArticles
				.map(article => articleCardHtml(data, article))
				.join("")
		: emptyHtml(
				entityArticles.length
					? "No articles match these filters."
					: "No articles archived yet."
			);

	const stats = getTeamStats(data, team.id);
	const statRows = [];

	statRows.push(`
		<dt>Active years</dt>
		<dd>
			${teamStatButton(team.id, "races", formatActiveYears(team.active_years))}
		</dd>
	`);

	if (stats.wins > 0) {
		statRows.push(`
			<dt>Wins</dt>
			<dd>
				${teamStatButton(team.id, "wins", stats.wins)}
			</dd>
		`);
	}

	if (stats.podiums > 0) {
		statRows.push(`
			<dt>Podiums</dt>
			<dd>
				${teamStatButton(team.id, "podiums", stats.podiums)}
			</dd>
		`);
	} else if (stats.bestFinish !== null) {
		statRows.push(`
			<dt>Best finish</dt>
			<dd>
				${teamStatButton(
					team.id,
					"best-finish",
					`${stats.bestFinish}${getOrdinal(stats.bestFinish)}`
				)}
			</dd>
		`);
	}

	if (stats.poles > 0) {
		statRows.push(`
			<dt>Pole positions</dt>
			<dd>
				${teamStatButton(team.id, "poles", stats.poles)}
			</dd>
		`);
	} else if (stats.bestGrid !== null) {
		statRows.push(`
			<dt>Best grid</dt>
			<dd>
				${teamStatButton(
					team.id,
					"best-grid",
					`${stats.bestGrid}${getOrdinal(stats.bestGrid)}`
				)}
			</dd>
		`);
	}

	if (stats.fastestLaps > 0) {
		statRows.push(`
			<dt>Fastest laps</dt>
			<dd>
				${teamStatButton(team.id, "fastest-laps", stats.fastestLaps)}
			</dd>
		`);
	}

	const hasChampionshipData =
		asArray(team.championship_results).filter(isObject).length > 0;

	if (stats.bestChampFinish !== null) {
		statRows.push(`
			<dt>Best championship</dt>
			<dd>
				${teamStatButton(
					team.id,
					"best-champ",
					`${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)}`
				)}
			</dd>
		`);
	} else if (hasChampionshipData) {
		statRows.push(`
			<dt>Best championship</dt>
			<dd>
				${teamStatButton(team.id, "best-champ", "Not classified")}
			</dd>
		`);
	}

	const constructorTitleYears = asArray(team.constructor_championships)
		.map(item => {
			return isObject(item) ? item.year : item;
		})
		.filter(year => year !== null && year !== undefined && year !== "")
		.map(Number)
		.filter(year => Number.isFinite(year) && year > 0)
		.sort((a, b) => a - b);

	const constructorTitles = constructorTitleYears.length;

	if (constructorTitles > 0) {
		statRows.push(`
			<dt>Constructor titles</dt>
			<dd>
				${teamStatButton(team.id, "constructor-titles", constructorTitles)}
			</dd>
		`);
	} else {
		statRows.push(`
			<dt>Constructor titles</dt>
			<dd>0</dd>
		`);
	}

	const seasons = asArray(team.seasons)
		.filter(year => year !== null && year !== undefined && String(year).trim() !== "");

	const seasonsHtml = seasons.length
		? `
			<div class="scroll-list">
				${seasons.map(year => `<span>${esc(year)}</span>`).join("")}
			</div>
		`
		: "—";

	const driverChamps = asArray(team.driver_championships)
		.filter(item => item !== null && item !== undefined);

	const driverChampsHtml = driverChamps.length
		? `
			<div class="scroll-list">
				${
					driverChamps
						.map(item => {
							if (isObject(item)) {
								const driver = item.driver_id
									? data.driversById[String(item.driver_id)]
									: null;

								const driverText = driver
									? ` — ${esc(driver.name)}`
									: "";

								return `<span>${esc(item.year ?? "")}${driverText}</span>`;
							}

							return `<span>${esc(item)}</span>`;
						})
						.join("")
				}
			</div>
		`
		: "—";

	const teamDrivers = uniqueIds(team.driver_ids)
		.map(id => data.driversById[id])
		.filter(Boolean)
		.sort((a, b) => {
			return String(a.sort_name || a.name || "").localeCompare(
				String(b.sort_name || b.name || "")
			);
		});

	const driversHtml = teamDrivers.length
		? `
			<div class="scroll-list">
				${
					teamDrivers
						.map(driver => `
							<a href="#/driver/${esc(driver.id)}">
								${esc(driver.name)}
							</a>
						`)
						.join("")
				}
			</div>
		`
		: "—";

	const teamWikipediaUrl = team.wikipedia_url
		? safeExternalUrl(team.wikipedia_url)
		: "#";

	const hasWikipedia =
		teamWikipediaUrl !== "#" &&
		Boolean(parseWikipediaUrl(team.wikipedia_url));

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
					hasWikipedia
						? `
							<p>
								<a href="${esc(teamWikipediaUrl)}" target="_blank" rel="noopener">
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
			<h1>${esc(team.name || team.id)}</h1>
			<p class="muted">
				${esc(team.nationality || "")}
				${
					team.active_years
						? ` • ${esc(formatActiveYears(team.active_years))}`
						: ""
				}
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
			loadWikiIntro(team.wikipedia_url, team.name || team.id);
		}
	};
}

function getOrdinal(n) {
	const value = Number(n);

	if (!Number.isFinite(value)) {
		return "th";
	}

	const abs = Math.abs(value);
	const mod10 = abs % 10;
	const mod100 = abs % 100;

	if (mod10 === 1 && mod100 !== 11) {
		return "st";
	}

	if (mod10 === 2 && mod100 !== 12) {
		return "nd";
	}

	if (mod10 === 3 && mod100 !== 13) {
		return "rd";
	}

	return "th";
}

function firstValidGridValue(...values) {
	for (const value of values) {
		const grid = parseGridValue(value);

		if (Number.isFinite(grid) && grid > 0) {
			return grid;
		}
	}

	return null;
}

function getDriverGridPos(p) {
	if (!p) {
		return null;
	}

	return firstValidGridValue(
		p.result ? p.result.grid : undefined,
		p.grid ? p.grid.position : undefined,
		p.quali ? p.quali.position : undefined
	);
}

function isValidChampionshipPosition(value) {
	const pos = parseInt(value, 10);

	return Number.isFinite(pos) && pos > 0 && pos <= 50;
}

function getDriverStats(data, driverId) {
	const key = String(driverId);

	if (caches.driverStats.has(key)) {
		return caches.driverStats.get(key);
	}

	const stats = computeDriverStats(data, driverId);

	caches.driverStats.set(key, stats);

	return stats;
}

function getTeamStats(data, teamId) {
	const key = String(teamId);

	if (caches.teamStats.has(key)) {
		return caches.teamStats.get(key);
	}

	const stats = computeTeamStats(data, teamId);

	caches.teamStats.set(key, stats);

	return stats;
}

function computeDriverStats(data, driverId) {
	const driverRaces = asArray(data.driverRacesIndex[driverId]).filter(isObject);
	const participations = [];

	driverRaces.forEach(race => {
		const qualifying = asArray(race.qualifying).filter(isObject);
		const results = asArray(race.results).filter(isObject);
		const grid = asArray(race.starting_grid).filter(isObject);

		const qualiEntry = qualifying.find(q => q.driver_id === driverId);
		const resultEntry = results.find(r => r.driver_id === driverId);
		const gridEntry = grid.find(g => g.driver_id === driverId);

		if (qualiEntry || resultEntry || gridEntry) {
			participations.push({
				race,
				quali: qualiEntry,
				result: resultEntry,
				grid: gridEntry
			});
		}
	});

	const wins = participations.filter(
		p => p.result && String(p.result.position || p.result.positionText) === "1"
	).length;

	const podiums = participations.filter(
		p =>
			p.result &&
			["1", "2", "3"].includes(String(p.result.position || p.result.positionText))
	).length;

	const poles = participations.filter(p => getDriverGridPos(p) === 1).length;

	const fastestLaps = participations.filter(
		p => p.result && String(p.result.fastest_lap_rank) === "1"
	).length;

	const finishes = participations
		.map(p => {
			return p.result
				? firstValidPosition(p.result.position, p.result.positionText)
				: NaN;
		})
		.filter(n => Number.isFinite(n) && n > 0);

	const bestFinish = finishes.length
		? Math.min(...finishes)
		: null;

	const grids = participations
		.map(p => getDriverGridPos(p))
		.filter(n => n !== null);

	const bestGrid = grids.length
		? Math.min(...grids)
		: null;

	const driver = data.driversById[driverId] || {};

	const champResults = asArray(driver.championship_results).filter(isObject);

	const validPositions = champResults
		.map(r => parseInt(r.position, 10))
		.filter(isValidChampionshipPosition);

	const bestChampFinish = validPositions.length
		? Math.min(...validPositions)
		: null;

	const bestChampYears = champResults
		.filter(r => parseInt(r.position, 10) === bestChampFinish)
		.map(r => r.year);

	return {
		participations,
		racesEntered: participations.length,
		wins,
		podiums,
		poles,
		fastestLaps,
		bestFinish,
		bestGrid,
		champResults,
		bestChampFinish,
		bestChampYears
	};
}

function computeTeamStats(data, teamId) {
	const index = buildTeamParticipationIndex(data);
	const participations = asArray(index[teamId]).filter(isObject);

	let wins = 0;
	let podiums = 0;
	let poles = 0;
	let fastestLaps = 0;
	let bestFinish = null;
	let bestGrid = null;

	participations.forEach(p => {
		const poleDrivers = new Set();

		const addPole = (entry, source, index) => {
			if (
				entry.driver_id !== null &&
				entry.driver_id !== undefined &&
				String(entry.driver_id).trim() !== ""
			) {
				poleDrivers.add(String(entry.driver_id));
			} else {
				poleDrivers.add(`${source}:${index}`);
			}
		};

		asArray(p.results)
			.filter(isObject)
			.forEach((r, resultIndex) => {
				const pos = firstValidPosition(r.position, r.positionText);

				if (Number.isFinite(pos)) {
					if (pos === 1) {
						wins++;
					}

					if (pos <= 3) {
						podiums++;
					}

					if (bestFinish === null || pos < bestFinish) {
						bestFinish = pos;
					}
				}

				if (String(r.fastest_lap_rank) === "1") {
					fastestLaps++;
				}

				const gridPos = parseGridValue(r.grid);

				if (Number.isFinite(gridPos) && gridPos > 0) {
					if (gridPos === 1) {
						addPole(r, "result", resultIndex);
					}

					if (bestGrid === null || gridPos < bestGrid) {
						bestGrid = gridPos;
					}
				}
			});

		const qualiAndGrid = [
			...asArray(p.qualis).filter(isObject),
			...asArray(p.grids).filter(isObject)
		];

		qualiAndGrid.forEach((q, index) => {
			const gPos = parseGridValue(q.position);

			if (Number.isFinite(gPos) && gPos > 0) {
				if (gPos === 1) {
					addPole(q, "quali/grid", index);
				}

				if (bestGrid === null || gPos < bestGrid) {
					bestGrid = gPos;
				}
			}
		});

		poles += poleDrivers.size;
	});

	const team = data.teamsById[teamId] || {};

	const champResults = asArray(team.championship_results).filter(isObject);

	const validPositions = champResults
		.map(r => parseInt(r.position, 10))
		.filter(isValidChampionshipPosition);

	const bestChampFinish = validPositions.length
		? Math.min(...validPositions)
		: null;

	return {
		participations,
		racesEntered: participations.length,
		wins,
		podiums,
		poles,
		fastestLaps,
		bestFinish,
		bestGrid,
		champResults,
		bestChampFinish
	};
}

function renderModal(title, count, countNoun, listHtml) {
	const trigger = document.activeElement;

	closeStatModal();

	lastFocusedElement = trigger;

	const safeTitle = esc(title || "Details");
	const safeCount = esc(count ?? 0);
	const noun = String(countNoun || "").trim();

	const modalHtml = `
		<div
			class="stat-modal-overlay"
			id="stat-modal"
			role="dialog"
			aria-modal="true"
			aria-label="${safeTitle}"
		>
			<div class="stat-modal">
				<button type="button" class="stat-modal-close" aria-label="Close">×</button>
				<h2>${safeTitle}</h2>
				<p class="muted">
					${safeCount} ${esc(noun)}${Number(count) === 1 ? "" : "s"}
				</p>
				<div class="stat-modal-content">
					${listHtml}
				</div>
			</div>
		</div>
	`;

	const modalContainer = document.createElement("div");
	modalContainer.id = "stat-modal-container";
	modalContainer.innerHTML = modalHtml;

	document.body.appendChild(modalContainer);

	const closeBtn = modalContainer.querySelector(".stat-modal-close");

	if (closeBtn) {
		closeBtn.focus();
		closeBtn.addEventListener("click", closeStatModal);
	}

	const overlay = modalContainer.querySelector(".stat-modal-overlay");

	if (overlay) {
		overlay.addEventListener("click", e => {
			if (e.target.id === "stat-modal") {
				closeStatModal();
			}
		});
	}

	document.addEventListener("keydown", handleModalKeydown);
	document.body.style.overflow = "hidden";
}

function handleModalKeydown(e) {
	if (e.key === "Escape") {
		closeStatModal();
		return;
	}

	if (e.key !== "Tab") {
		return;
	}

	const container = document.getElementById("stat-modal-container");

	if (!container) {
		document.removeEventListener("keydown", handleModalKeydown);
		return;
	}

	const focusables = Array.from(container.querySelectorAll(`
		button:not(:disabled),
		[href],
		input:not(:disabled),
		select:not(:disabled),
		textarea:not(:disabled),
		[tabindex]:not([tabindex="-1"])
	`)).filter(element => {
		return !element.hidden && element.getClientRects().length > 0;
	});

	if (!focusables.length) {
		return;
	}

	const first = focusables[0];
	const last = focusables[focusables.length - 1];

	if (e.shiftKey && document.activeElement === first) {
		e.preventDefault();
		last.focus();
	} else if (!e.shiftKey && document.activeElement === last) {
		e.preventDefault();
		first.focus();
	} else if (!container.contains(document.activeElement)) {
		e.preventDefault();
		first.focus();
	}
}

function closeStatModal() {
	const container = document.getElementById("stat-modal-container");

	if (container) {
		container.remove();
	}

	document.removeEventListener("keydown", handleModalKeydown);
	document.body.style.overflow = "";

	if (
		lastFocusedElement &&
		document.contains(lastFocusedElement) &&
		!lastFocusedElement.disabled
	) {
		try {
			lastFocusedElement.focus();
		} catch {
			// Ignore focus errors.
		}
	}

	lastFocusedElement = null;
}

function getRacesByYear(data) {
	if (caches.racesByYear) {
		return caches.racesByYear;
	}

	caches.racesByYear = Object.create(null);

	data.races.forEach(race => {
		const season = Number(race.season);

		const year = Number.isFinite(season) && season > 0
			? String(season)
			: "unknown";

		if (!caches.racesByYear[year]) {
			caches.racesByYear[year] = [];
		}

		caches.racesByYear[year].push(race);
	});

	return caches.racesByYear;
}

function getDriverTeamInYear(data, driverId, year) {
	const races = asArray(getRacesByYear(data)[year]).filter(isObject);

	for (const race of races) {
		const result = asArray(race.results)
			.filter(isObject)
			.find(r => r.driver_id === driverId);

		if (result && result.team) {
			return result.team;
		}

		const grid = asArray(race.starting_grid)
			.filter(isObject)
			.find(g => g.driver_id === driverId);

		if (grid && grid.team) {
			return grid.team;
		}

		const quali = asArray(race.qualifying)
			.filter(isObject)
			.find(q => q.driver_id === driverId);

		if (quali && quali.team) {
			return quali.team;
		}
	}

	return "";
}

function getTeamDriversInYear(data, teamId, year) {
	const races = asArray(getRacesByYear(data)[year]).filter(isObject);
	const drivers = new Set();

	for (const race of races) {
		asArray(race.results)
			.filter(isObject)
			.forEach(r => {
				if (r.driver_id && resolveTeamId(data, r.team) === teamId) {
					drivers.add(String(r.driver_id));
				}
			});

		asArray(race.starting_grid)
			.filter(isObject)
			.forEach(g => {
				if (g.driver_id && resolveTeamId(data, g.team) === teamId) {
					drivers.add(String(g.driver_id));
				}
			});
	}

	return Array.from(drivers);
}

function formatRaceEntry(data, p) {
	if (!p || !p.race) {
		return "";
	}

	const raceName = `${p.race.name || ""} ${p.race.season || ""}`.trim();
	const raceLink = `#/race/${encodeURIComponent(p.race.id ?? "")}`;

	const details = [];

	const teamName = p.result
		? (p.result.team || p.result.constructor)
		: (p.grid
			? (p.grid.team || p.grid.constructor)
			: (p.quali ? (p.quali.team || p.quali.constructor) : ""));

	if (teamName) {
		details.push(teamLinkHtml(data, teamName));
	}

	const gridPos = getDriverGridPos(p);

	if (gridPos !== null) {
		details.push(`Grid ${gridPos}${gridPos === 1 ? " (Pole)" : ""}`);
	} else if (
		p.quali &&
		p.quali.position !== null &&
		p.quali.position !== undefined &&
		!/^\d+$/.test(String(p.quali.position))
	) {
		details.push(esc(String(p.quali.position)));
	}

	if (p.result) {
		const status = p.result.status || p.result.statusText || "";
		const pos = String(p.result.position ?? p.result.positionText ?? "");
		const posNumber = parsePositionValue(pos);
		const normalizedStatus = normalizeString(status);

		if (normalizedStatus.includes("disqual") || pos === "DSQ") {
			details.push("DSQ");
		} else if (Number.isFinite(posNumber)) {
			details.push(`Finished ${posNumber}${getOrdinal(posNumber)}`);
		} else if (status && status !== "Finished") {
			details.push(`Retired (${esc(status)})`);
		} else if (status === "Finished") {
			details.push("Finished");
		} else if (pos && String(pos).trim() !== "0") {
			details.push(esc(pos));
		} else {
			details.push("Retired");
		}
	} else {
		if (gridPos !== null) {
			details.push("No race result");
		} else {
			details.push("Did not qualify / Did not start");
		}
	}

	return `
		<li>
			<a href="${esc(raceLink)}">${esc(raceName)}</a>
			<span class="muted">${details.join(" • ")}</span>
		</li>
	`;
}

function formatTeamRaceEntry(data, p, statType) {
	if (!p || !p.race) {
		return "";
	}

	const raceName = `${p.race.name || ""} ${p.race.season || ""}`.trim();
	const raceLink = `#/race/${encodeURIComponent(p.race.id ?? "")}`;

	const details = [];

	const makeDriverLink = entry => {
		const driverId = entry?.driver_id;

		const driver = driverId === null || driverId === undefined
			? null
			: data.driversById[String(driverId)];

		if (driver) {
			return `
				<a href="#/driver/${esc(driver.id)}">
					${esc(driver.name)}
				</a>
			`;
		}

		return esc(entry?.driver_name || driverId || "Unknown driver");
	};

	const results = asArray(p.results).filter(isObject);

	const displayPos = r => r.position || r.positionText || "—";

	if (statType === "races") {
		results.forEach(r => {
			details.push(`${makeDriverLink(r)}: P${esc(displayPos(r))}`);
		});
	} else if (statType === "wins") {
		results
			.filter(r => String(r.position || r.positionText || "") === "1")
			.forEach(r => {
				details.push(`${makeDriverLink(r)} won`);
			});
	} else if (statType === "podiums") {
		results
			.filter(r => ["1", "2", "3"].includes(String(r.position || r.positionText || "")))
			.forEach(r => {
				const posRaw = displayPos(r);
				const posNumber = firstValidPosition(posRaw);

				const posLabel = Number.isFinite(posNumber)
					? `${posNumber}${getOrdinal(posNumber)}`
					: esc(posRaw);

				details.push(`${makeDriverLink(r)} finished ${posLabel}`);
			});
	} else if (statType === "poles") {
		const poleEntries = [];
		const seen = new Set();

		const addPoleEntry = (entry, source, index) => {
			const key =
				entry.driver_id ||
				entry.driver_name ||
				`${source}:${index}`;

			if (seen.has(key)) {
				return;
			}

			seen.add(key);
			poleEntries.push(entry);
		};

		results
			.filter(r => parseGridValue(r.grid) === 1)
			.forEach((r, index) => addPoleEntry(r, "result", index));

		asArray(p.qualis)
			.filter(isObject)
			.filter(q => parseGridValue(q.position) === 1)
			.forEach((q, index) => addPoleEntry(q, "quali", index));

		asArray(p.grids)
			.filter(isObject)
			.filter(g => parseGridValue(g.position) === 1)
			.forEach((g, index) => addPoleEntry(g, "grid", index));

		poleEntries.forEach(entry => {
			details.push(`${makeDriverLink(entry)} on pole`);
		});
	} else if (statType === "fastest-laps") {
		results
			.filter(r => String(r.fastest_lap_rank) === "1")
			.forEach(r => {
				details.push(`${makeDriverLink(r)} fastest lap`);
			});
	} else {
		results.forEach(r => {
			details.push(`${makeDriverLink(r)}: P${esc(displayPos(r))}`);
		});
	}

	return `
		<li>
			<a href="${esc(raceLink)}">${esc(raceName)}</a>
			<span class="muted">${details.join(" • ")}</span>
		</li>
	`;
}

function buildChampionshipModalContent(data, entityName, entity, stats, isTeam) {
	const isChampion = stats.bestChampFinish === 1;
	const hasValidFinish = stats.bestChampFinish !== null;

	const champLabel = isTeam
		? "Constructor Championships"
		: "World Championships";

	const safeEntityName = entityName || "Unknown";

	const title = isChampion
		? `${safeEntityName} - ${champLabel}`
		: hasValidFinish
			? `${safeEntityName} - Best Championship Finishes (${stats.bestChampFinish}${getOrdinal(stats.bestChampFinish)})`
			: `${safeEntityName} - Championship Standings`;

	const champResults = asArray(entity.championship_results)
		.filter(isObject)
		.filter(r => {
			return hasValidFinish
				? parseInt(r.position, 10) === stats.bestChampFinish
				: true;
		})
		.sort((a, b) => (Number(a.year) || 0) - (Number(b.year) || 0));

	let listHtml = `<ul class="stat-list">`;

	champResults.forEach(r => {
		const pos = parseInt(r.position, 10);
		const isNC = !isValidChampionshipPosition(pos);

		const posText = isNC
			? "Not classified"
			: `${pos}${getOrdinal(pos)}`;

		const label = isChampion
			? (isTeam ? "Constructor Champion" : "World Champion")
			: posText;

		let extraHtml = "";

		if (isTeam) {
			const driverIds = getTeamDriversInYear(data, entity.id, r.year)
				.filter(Boolean);

			extraHtml = driverIds
				.map(driverId => {
					const driver = data.driversById[driverId];

					return driver
						? `<a href="#/driver/${esc(driver.id)}">${esc(driver.name)}</a>`
						: esc(driverId);
				})
				.join(", ") || "Unknown drivers";
		} else {
			const teamName = getDriverTeamInYear(data, entity.id, r.year);
			extraHtml = teamName ? teamLinkHtml(data, teamName) : "";
		}

		const pointsHtml =
			r.points !== null && r.points !== undefined && r.points !== ""
				? ` • ${esc(r.points)} pts`
				: "";

		const extra = extraHtml ? ` • ${extraHtml}` : "";

		listHtml += `
			<li>
				<span>${esc(r.year ?? "")}</span>
				<span class="muted">
					${esc(label)}${extra}${pointsHtml}
				</span>
			</li>
		`;
	});

	listHtml += `</ul>`;

	if (!champResults.length) {
		listHtml = `<p class="muted">No championship finishes recorded.</p>`;
	}

	return {
		title,
		listHtml,
		count: champResults.length
	};
}

function showStatModal(data, driverId, statType) {
	if (!KNOWN_DRIVER_STATS.has(statType)) {
		return;
	}

	const driver = data.driversById[driverId];

	if (!driver) {
		return;
	}

	const stats = getDriverStats(data, driverId);
	const participations = stats.participations;
	const driverLabel = driver.name || driverId;

	let title = "";
	let filtered = [];

	if (statType === "races") {
		title = `${driverLabel} - All Races`;
		filtered = participations;
	} else if (statType === "wins") {
		title = `${driverLabel} - Wins`;
		filtered = participations.filter(
			p => p.result && String(p.result.position || p.result.positionText) === "1"
		);
	} else if (statType === "podiums") {
		title = `${driverLabel} - Podiums`;
		filtered = participations.filter(
			p =>
				p.result &&
				["1", "2", "3"].includes(String(p.result.position || p.result.positionText))
		);
	} else if (statType === "poles") {
		title = `${driverLabel} - Pole Positions`;
		filtered = participations.filter(p => getDriverGridPos(p) === 1);
	} else if (statType === "fastest-laps") {
		title = `${driverLabel} - Fastest Laps`;
		filtered = participations.filter(
			p => p.result && String(p.result.fastest_lap_rank) === "1"
		);
	} else if (statType === "best-finish" && stats.bestFinish !== null) {
		title = `${driverLabel} - Best Finishes (${stats.bestFinish}${getOrdinal(stats.bestFinish)})`;
		filtered = participations.filter(
			p =>
				p.result &&
				firstValidPosition(p.result.position, p.result.positionText) === stats.bestFinish
		);
	} else if (statType === "best-grid" && stats.bestGrid !== null) {
		title = `${driverLabel} - Best Grid Positions (${stats.bestGrid}${getOrdinal(stats.bestGrid)})`;
		filtered = participations.filter(p => getDriverGridPos(p) === stats.bestGrid);
	} else if (statType === "best-champ") {
		const modal = buildChampionshipModalContent(
			data,
			driverLabel,
			driver,
			stats,
			false
		);

		renderModal(modal.title, modal.count, "season", modal.listHtml);
		return;
	}

	if (!title) {
		return;
	}

	filtered.sort((a, b) => {
		return String(b.race.date || b.race.season || "").localeCompare(
			String(a.race.date || a.race.season || "")
		);
	});

	let listHtml = "";

	if (statType === "races") {
		const grouped = Object.create(null);

		filtered.forEach(p => {
			const year = p.race.season || "Unknown";

			if (!grouped[year]) {
				grouped[year] = [];
			}

			grouped[year].push(p);
		});

		const years = Object.keys(grouped).sort((a, b) => {
			if (a === "Unknown") return 1;
			if (b === "Unknown") return -1;
			return Number(b) - Number(a);
		});

		years.forEach(year => {
			listHtml += `<h3 class="modal-year">${esc(year)}</h3><ul class="stat-list">`;

			grouped[year].forEach(p => {
				listHtml += formatRaceEntry(data, p);
			});

			listHtml += `</ul>`;
		});
	} else {
		listHtml = `<ul class="stat-list">`;

		filtered.forEach(p => {
			listHtml += formatRaceEntry(data, p);
		});

		listHtml += `</ul>`;
	}

	if (!filtered.length) {
		listHtml = `<p class="muted">No races found.</p>`;
	}

	renderModal(title, filtered.length, "race", listHtml);
}

function showTeamStatModal(data, teamId, statType) {
	if (!KNOWN_TEAM_STATS.has(statType)) {
		return;
	}

	const team = data.teamsById[teamId];

	if (!team) {
		return;
	}

	const stats = getTeamStats(data, teamId);
	const participations = stats.participations;
	const teamLabel = team.name || teamId;

	let title = "";
	let filtered = [];

	if (statType === "races") {
		title = `${teamLabel} - All Races`;
		filtered = participations;
	} else if (statType === "wins") {
		title = `${teamLabel} - Wins`;
		filtered = participations.filter(
			p =>
				asArray(p.results)
					.filter(isObject)
					.some(r => String(r.position || r.positionText) === "1")
		);
	} else if (statType === "podiums") {
		title = `${teamLabel} - Podiums`;
		filtered = participations.filter(
			p =>
				asArray(p.results)
					.filter(isObject)
					.some(r => ["1", "2", "3"].includes(String(r.position || r.positionText)))
		);
	} else if (statType === "poles") {
		title = `${teamLabel} - Pole Positions`;
		filtered = participations.filter(p => {
			return (
				asArray(p.results)
					.filter(isObject)
					.some(r => parseGridValue(r.grid) === 1) ||
				asArray(p.qualis)
					.filter(isObject)
					.some(q => parseGridValue(q.position) === 1) ||
				asArray(p.grids)
					.filter(isObject)
					.some(g => parseGridValue(g.position) === 1)
			);
		});
	} else if (statType === "fastest-laps") {
		title = `${teamLabel} - Fastest Laps`;
		filtered = participations.filter(
			p =>
				asArray(p.results)
					.filter(isObject)
					.some(r => String(r.fastest_lap_rank) === "1")
		);
	} else if (statType === "best-finish" && stats.bestFinish !== null) {
		title = `${teamLabel} - Best Finishes (${stats.bestFinish}${getOrdinal(stats.bestFinish)})`;
		filtered = participations.filter(
			p =>
				asArray(p.results)
					.filter(isObject)
					.some(r => firstValidPosition(r.position, r.positionText) === stats.bestFinish)
		);
	} else if (statType === "best-grid" && stats.bestGrid !== null) {
		title = `${teamLabel} - Best Grid Positions (${stats.bestGrid}${getOrdinal(stats.bestGrid)})`;
		filtered = participations.filter(p => {
			return (
				asArray(p.results)
					.filter(isObject)
					.some(r => parseGridValue(r.grid) === stats.bestGrid) ||
				asArray(p.qualis)
					.filter(isObject)
					.some(q => parseGridValue(q.position) === stats.bestGrid) ||
				asArray(p.grids)
					.filter(isObject)
					.some(g => parseGridValue(g.position) === stats.bestGrid)
			);
		});
	} else if (statType === "constructor-titles") {
		title = `${teamLabel} - Constructor Championships`;

		const years = asArray(team.constructor_championships)
			.map(item => {
				return isObject(item) ? item.year : item;
			})
			.filter(year => year !== null && year !== undefined && year !== "")
			.map(Number)
			.filter(year => Number.isFinite(year) && year > 0)
			.sort((a, b) => a - b);

		let listHtml = `<ul class="stat-list">`;

		years.forEach(year => {
			const driverIds = getTeamDriversInYear(data, teamId, year)
				.filter(Boolean);

			const driversHtml = driverIds
				.map(driverId => {
					const driver = data.driversById[driverId];

					return driver
						? `<a href="#/driver/${esc(driver.id)}">${esc(driver.name)}</a>`
						: esc(driverId);
				})
				.join(", ") || "Unknown drivers";

			listHtml += `
				<li>
					<span>${esc(year)}</span>
					<span class="muted">
						Constructor Champion • ${driversHtml}
					</span>
				</li>
			`;
		});

		listHtml += `</ul>`;

		if (!years.length) {
			listHtml = `<p class="muted">No constructor championships recorded.</p>`;
		}

		renderModal(title, years.length, "title", listHtml);
		return;
	} else if (statType === "best-champ") {
		const modal = buildChampionshipModalContent(
			data,
			teamLabel,
			team,
			stats,
			true
		);

		renderModal(modal.title, modal.count, "season", modal.listHtml);
		return;
	}

	if (!title) {
		return;
	}

	filtered.sort((a, b) => {
		return String(b.race.date || b.race.season || "").localeCompare(
			String(a.race.date || a.race.season || "")
		);
	});

	let listHtml = "";

	if (statType === "races") {
		const grouped = Object.create(null);

		filtered.forEach(p => {
			const year = p.race.season || "Unknown";

			if (!grouped[year]) {
				grouped[year] = [];
			}

			grouped[year].push(p);
		});

		const years = Object.keys(grouped).sort((a, b) => {
			if (a === "Unknown") return 1;
			if (b === "Unknown") return -1;
			return Number(b) - Number(a);
		});

		years.forEach(year => {
			listHtml += `<h3 class="modal-year">${esc(year)}</h3><ul class="stat-list">`;

			grouped[year].forEach(p => {
				listHtml += formatTeamRaceEntry(data, p, statType);
			});

			listHtml += `</ul>`;
		});
	} else {
		listHtml = `<ul class="stat-list">`;

		filtered.forEach(p => {
			listHtml += formatTeamRaceEntry(data, p, statType);
		});

		listHtml += `</ul>`;
	}

	if (!filtered.length) {
		listHtml = `<p class="muted">No races found.</p>`;
	}

	renderModal(title, filtered.length, "race", listHtml);
}

function formatActiveYears(years) {
	if (!years) {
		return "—";
	}

	let value = Array.isArray(years)
		? years
				.filter(item => item !== null && item !== undefined && item !== "")
				.join("-")
		: years;

	value = String(value).trim();

	if (!value) {
		return "—";
	}

	const parts = value
		.split(/[–-]/)
		.map(part => part.trim())
		.filter(Boolean);

	if (parts.length === 2 && parts[0] === parts[1]) {
		return parts[0];
	}

	return value;
}

init();