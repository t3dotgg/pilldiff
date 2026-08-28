(function () {
  "use strict";

  const playlists = Array.isArray(window.SIDEBAR_MOCK_DATA) ? window.SIDEBAR_MOCK_DATA : [];
  const defaultPlaylistId = "4187003885016673397";
  const categoryOrder = ["Monthly", "Year-end", "Midyear", "Jersey club", "Baile funk", "Roundups", "Features"];
  const state = {
    selectedPlaylistId: playlists.some((playlist) => playlist.id === defaultPlaylistId)
      ? defaultPlaylistId
      : playlists[0]?.id || "",
  };

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function formatDate(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  }

  function pluralize(value, singular, plural) {
    return `${value} ${value === 1 ? singular : plural}`;
  }

  function appendPlaylistMeta(container, playlist) {
    container.append(createElement("span", "", playlist.category));
    container.append(createElement("span", "", pluralize(playlist.entryCount, "entry", "entries")));
    if (playlist.noteCount > 0) {
      container.append(createElement("span", "", pluralize(playlist.noteCount, "note", "notes")));
    }
  }

  function buildPlaylistButton(playlist) {
    const button = createElement("button", "playlist-row");
    button.type = "button";
    button.dataset.playlistId = playlist.id;
    button.setAttribute("aria-current", String(playlist.id === state.selectedPlaylistId));

    const title = createElement("span", "playlist-title", playlist.shortTitle);
    const metadata = createElement("span", "playlist-meta");
    appendPlaylistMeta(metadata, playlist);
    button.append(title, metadata);
    button.addEventListener("click", () => selectPlaylist(playlist.id));
    return button;
  }

  function buildPlaylistList(items) {
    const list = createElement("ul", "playlist-list");
    for (const playlist of items) {
      const item = document.createElement("li");
      item.append(buildPlaylistButton(playlist));
      list.append(item);
    }
    return list;
  }

  function buildEmptyState(title, message, onClear) {
    const emptyState = createElement("div", "empty-state");
    const heading = createElement("strong", "", title);
    const body = createElement("p", "", message);
    const button = createElement("button", "clear-button", "Clear filters");
    button.type = "button";
    button.dataset.action = "clear-filters";
    button.addEventListener("click", onClear);
    emptyState.append(heading, body, button);
    return emptyState;
  }

  function groupedByYear(items) {
    const groups = new Map();
    for (const playlist of items) {
      if (!groups.has(playlist.year)) groups.set(playlist.year, []);
      groups.get(playlist.year).push(playlist);
    }
    return [...groups.entries()].sort((firstGroup, secondGroup) => secondGroup[0] - firstGroup[0]);
  }

  function matchesSearch(playlist, query) {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return true;
    const searchableText = [playlist.shortTitle, playlist.title, playlist.category, String(playlist.year)]
      .join(" ")
      .toLocaleLowerCase();
    return searchableText.includes(normalizedQuery);
  }

  function updateSelectionStates() {
    for (const button of document.querySelectorAll("[data-playlist-id]")) {
      button.setAttribute("aria-current", String(button.dataset.playlistId === state.selectedPlaylistId));
    }
  }

  function selectPlaylist(playlistId) {
    if (!playlists.some((playlist) => playlist.id === playlistId)) return;
    state.selectedPlaylistId = playlistId;
    updateSelectionStates();
    renderPreview();
  }

  function renderPreview() {
    const playlist = playlists.find((candidate) => candidate.id === state.selectedPlaylistId);
    if (!playlist) return;

    const eyebrow = document.getElementById("preview-eyebrow");
    const title = document.getElementById("preview-title");
    const details = document.getElementById("preview-details");
    const sourceLink = document.getElementById("preview-source-link");
    const trackSample = document.getElementById("preview-track-sample");
    const trackSummary = document.getElementById("preview-track-summary");
    const artworkImage = document.getElementById("preview-artwork");
    const artworkPlaceholder = document.getElementById("preview-artwork-placeholder");

    eyebrow.textContent = `${playlist.category} / ${playlist.year}`;
    title.textContent = playlist.shortTitle;
    details.replaceChildren();
    details.append(createElement("span", "", formatDate(playlist.publishedAt)));
    details.append(createElement("span", "", pluralize(playlist.entryCount, "entry", "entries")));
    if (playlist.noteCount > 0) {
      details.append(createElement("span", "", pluralize(playlist.noteCount, "song note", "song notes")));
    }

    sourceLink.href = playlist.sourceUrl;
    sourceLink.setAttribute("aria-label", `Open the original post for ${playlist.shortTitle}`);
    trackSummary.textContent = `Previewing ${playlist.tracks.length} of ${playlist.entryCount} entries`;
    trackSample.replaceChildren();

    for (const track of playlist.tracks) {
      const item = document.createElement("li");
      const rank = createElement("span", "track-rank", track.rank === null ? "—" : String(track.rank));
      const copy = createElement("span", "track-copy");
      copy.append(createElement("strong", "", track.title));
      if (track.artist) copy.append(createElement("span", "", track.artist));
      item.append(rank, copy);
      if (track.hasDescription) item.append(createElement("span", "track-note", "Has note"));
      trackSample.append(item);
    }

    artworkImage.hidden = true;
    artworkImage.removeAttribute("src");
    artworkImage.dataset.playlistId = playlist.id;
    artworkImage.alt = `Original post artwork for ${playlist.shortTitle}`;
    artworkPlaceholder.hidden = false;
    artworkPlaceholder.textContent = playlist.artworkUrl
      ? "Loading original post artwork"
      : "No artwork is available for this post";
    if (playlist.artworkUrl) artworkImage.src = playlist.artworkUrl;
  }

  function initializeArtworkEvents() {
    const artworkImage = document.getElementById("preview-artwork");
    const artworkPlaceholder = document.getElementById("preview-artwork-placeholder");
    artworkImage.addEventListener("load", () => {
      if (artworkImage.dataset.playlistId !== state.selectedPlaylistId) return;
      artworkImage.hidden = false;
      artworkPlaceholder.hidden = true;
    });
    artworkImage.addEventListener("error", () => {
      if (artworkImage.dataset.playlistId !== state.selectedPlaylistId) return;
      artworkImage.hidden = true;
      artworkPlaceholder.hidden = false;
      artworkPlaceholder.textContent = "Original post artwork unavailable";
    });
  }

  function populateSelect(select, options, allLabel) {
    select.replaceChildren();
    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = allLabel;
    select.append(allOption);
    for (const optionValue of options) {
      const option = document.createElement("option");
      option.value = String(optionValue);
      option.textContent = String(optionValue);
      select.append(option);
    }
  }

  function initializeReadingList() {
    const search = document.getElementById("reading-search");
    const yearSelect = document.getElementById("reading-year");
    const categorySelect = document.getElementById("reading-category");
    const results = document.getElementById("reading-results");
    const summary = document.getElementById("reading-summary");
    const years = [...new Set(playlists.map((playlist) => playlist.year))].sort((firstYear, secondYear) => secondYear - firstYear);
    const categories = categoryOrder.filter((category) => playlists.some((playlist) => playlist.category === category));
    populateSelect(yearSelect, years, "All years");
    populateSelect(categorySelect, categories, "All series");

    function clearFilters() {
      search.value = "";
      yearSelect.value = "all";
      categorySelect.value = "all";
      render();
      search.focus();
    }

    function render() {
      const filtered = playlists.filter((playlist) => {
        const yearMatches = yearSelect.value === "all" || String(playlist.year) === yearSelect.value;
        const categoryMatches = categorySelect.value === "all" || playlist.category === categorySelect.value;
        return yearMatches && categoryMatches && matchesSearch(playlist, search.value);
      });
      summary.textContent = pluralize(filtered.length, "playlist", "playlists");
      results.replaceChildren();
      if (filtered.length === 0) {
        results.append(buildEmptyState("No playlists found", "Try a different title, year, or series.", clearFilters));
        return;
      }
      const groups = createElement("div", "archive-groups");
      for (const [year, yearPlaylists] of groupedByYear(filtered)) {
        groups.append(createElement("h2", "year-divider", String(year)));
        groups.append(buildPlaylistList(yearPlaylists));
      }
      results.append(groups);
    }

    search.addEventListener("input", render);
    yearSelect.addEventListener("change", render);
    categorySelect.addEventListener("change", render);
    render();

    requestAnimationFrame(() => {
      const selected = results.querySelector(`[data-playlist-id="${defaultPlaylistId}"]`);
      if (selected && window.matchMedia("(min-width: 901px)").matches) {
        const selectedOffset = selected.getBoundingClientRect().top
          - results.getBoundingClientRect().top - results.clientTop + results.scrollTop;
        const maxScrollTop = Math.max(0, results.scrollHeight - results.clientHeight);
        results.scrollTop = Math.min(maxScrollTop, Math.max(0, selectedOffset - results.clientHeight * 0.32));
      }
    });
  }

  function initializeYearIndex() {
    const search = document.getElementById("year-search");
    const results = document.getElementById("year-results");
    const summary = document.getElementById("year-summary");
    const initiallyOpenYears = new Set([2025, 2024]);

    function clearFilters() {
      search.value = "";
      render();
      search.focus();
    }

    function render() {
      const query = search.value;
      const filtered = playlists.filter((playlist) => matchesSearch(playlist, query));
      summary.textContent = query.trim()
        ? pluralize(filtered.length, "matching playlist", "matching playlists")
        : pluralize(playlists.length, "playlist", "playlists");
      results.replaceChildren();
      if (filtered.length === 0) {
        results.append(buildEmptyState("No playlists found", "Search by a title, series, or year.", clearFilters));
        return;
      }

      for (const [year, yearPlaylists] of groupedByYear(filtered)) {
        const totalForYear = playlists.filter((playlist) => playlist.year === year).length;
        const details = createElement("details", "year-group");
        details.dataset.year = String(year);
        details.open = query.trim().length > 0 || initiallyOpenYears.has(year);
        const summaryElement = document.createElement("summary");
        const label = createElement("span", "year-summary-label", String(year));
        const count = createElement("span", "year-count", pluralize(totalForYear, "playlist", "playlists"));
        summaryElement.append(label, count);
        details.append(summaryElement, buildPlaylistList(yearPlaylists));
        results.append(details);
      }
    }

    search.addEventListener("input", render);
    render();
  }

  function initializeSeriesLibrary() {
    const categoryList = document.getElementById("series-category-list");
    const search = document.getElementById("series-search");
    const yearSelect = document.getElementById("series-year");
    const results = document.getElementById("series-results");
    const summary = document.getElementById("series-summary");
    let activeCategory = "Year-end";

    function categoryCount(category) {
      return category === "all"
        ? playlists.length
        : playlists.filter((playlist) => playlist.category === category).length;
    }

    function renderCategoryRail() {
      categoryList.replaceChildren();
      const choices = ["all", ...categoryOrder.filter((category) => categoryCount(category) > 0)];
      for (const category of choices) {
        const item = document.createElement("li");
        const label = category === "all" ? "All playlists" : category;
        const button = createElement("button", "series-choice");
        button.type = "button";
        button.dataset.category = category;
        button.setAttribute("aria-pressed", String(category === activeCategory));
        button.append(
          createElement("span", "", label),
          createElement("span", "", String(categoryCount(category))),
        );
        button.addEventListener("click", () => {
          activeCategory = category;
          yearSelect.value = "all";
          for (const categoryButton of categoryList.querySelectorAll("[data-category]")) {
            categoryButton.setAttribute("aria-pressed", String(categoryButton.dataset.category === activeCategory));
          }
          renderYearOptions();
          renderResults();
        });
        item.append(button);
        categoryList.append(item);
      }
    }

    function categoryPlaylists() {
      return activeCategory === "all"
        ? playlists
        : playlists.filter((playlist) => playlist.category === activeCategory);
    }

    function renderYearOptions() {
      const currentValue = yearSelect.value || "all";
      const years = [...new Set(categoryPlaylists().map((playlist) => playlist.year))]
        .sort((firstYear, secondYear) => secondYear - firstYear);
      populateSelect(yearSelect, years, "All years");
      yearSelect.value = years.some((year) => String(year) === currentValue) ? currentValue : "all";
    }

    function clearFilters() {
      search.value = "";
      yearSelect.value = "all";
      renderResults();
      search.focus();
    }

    function renderResults() {
      const filtered = categoryPlaylists().filter((playlist) => {
        const yearMatches = yearSelect.value === "all" || String(playlist.year) === yearSelect.value;
        return yearMatches && matchesSearch(playlist, search.value);
      });
      summary.textContent = pluralize(filtered.length, "playlist", "playlists");
      results.replaceChildren();
      if (filtered.length === 0) {
        results.append(buildEmptyState("Nothing in this view", "Clear the search and year filter to see this series again.", clearFilters));
        return;
      }
      for (const [year, yearPlaylists] of groupedByYear(filtered)) {
        results.append(createElement("h2", "year-divider", String(year)));
        results.append(buildPlaylistList(yearPlaylists));
      }
    }

    search.addEventListener("input", renderResults);
    yearSelect.addEventListener("change", renderResults);
    renderCategoryRail();
    renderYearOptions();
    renderResults();
  }

  function initialize() {
    if (playlists.length === 0) return;
    initializeArtworkEvents();
    renderPreview();
    const layout = document.body.dataset.layout;
    if (layout === "reading") initializeReadingList();
    if (layout === "year-index") initializeYearIndex();
    if (layout === "series") initializeSeriesLibrary();
  }

  initialize();
})();
