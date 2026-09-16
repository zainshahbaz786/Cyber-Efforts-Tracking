(function (CET) {
  const { CONFIG } = CET;

  function getWebUrl() {
    if (CET.CONFIG.siteWebUrl) {
      return String(CET.CONFIG.siteWebUrl).replace(/\/$/, '');
    }
    if (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo && _spPageContextInfo.webAbsoluteUrl) {
      return _spPageContextInfo.webAbsoluteUrl;
    }
    const path = window.location.pathname || '';
    const lower = path.toLowerCase();
    const markers = ['/siteassets/', '/_layouts/', '/_catalogs/'];
    for (const marker of markers) {
      const idx = lower.indexOf(marker);
      if (idx > 0) {
        return window.location.origin + path.substring(0, idx);
      }
    }
    const sitesMatch = path.match(/^(\/sites\/[^/]+)/i);
    if (sitesMatch) {
      return window.location.origin + sitesMatch[1];
    }
    const teamsMatch = path.match(/^(\/teams\/[^/]+)/i);
    if (teamsMatch) {
      return window.location.origin + teamsMatch[1];
    }
    return window.location.origin;
  }

  function getSp() {
    if (typeof $pnp === 'undefined' || !$pnp.sp) {
      throw new Error('PnP.js is not loaded. Add libs/pnp-3.0.10.js to Site Assets.');
    }
    const baseUrl = getWebUrl();
    try {
      $pnp.sp.setup({ sp: { baseUrl } });
    } catch (_) {
      /* setup may already be applied */
    }
    return $pnp.sp;
  }

  async function createRecord(listName, data) {
    try {
      return await getSp().web.lists.getByTitle(listName).items.add(data);
    } catch (err) {
      console.error('Create failed:', err);
      throw err;
    }
  }

  async function updateRecord(listName, itemId, data) {
    const run = () => getSp().web.lists.getByTitle(listName).items.getById(itemId).update(data);
    try {
      await run();
      return true;
    } catch (err) {
      console.warn('Update failed, retrying once:', err);
      await run();
      return true;
    }
  }

  async function deleteRecord(listName, itemId) {
    const run = () => getSp().web.lists.getByTitle(listName).items.getById(itemId).delete();
    try {
      await run();
      return true;
    } catch (err) {
      console.warn('Delete failed, retrying once:', err);
      await run();
      return true;
    }
  }

  /** Same pattern as your working snippet — most reliable for Site Assets apps. */
  async function readRecordsSimple(listName) {
    try {
      const items = await getSp().web.lists.getByTitle(listName).items.select('*').get();
      return items || [];
    } catch (err) {
      console.error(`Read failed (${listName}, select *):`, err);
      throw err;
    }
  }

  async function readRecords(listName, options) {
    const opts = options || {};
    if (opts.simple === true || (!opts.select && !opts.expand && !opts.filter && !opts.orderBy)) {
      return readRecordsSimple(listName);
    }

    const top = opts.top || CONFIG.pageSize;
    let query = getSp().web.lists.getByTitle(listName).items;

    if (opts.select && opts.select.length) query = query.select(...opts.select);
    if (opts.expand && opts.expand.length) query = query.expand(...opts.expand);
    if (opts.filter) query = query.filter(opts.filter);
    query = query.top(top);

    if (opts.orderBy) {
      const parts = opts.orderBy.split(' ');
      query = query.orderBy(parts[0], parts[1] === 'desc');
    }

    try {
      if (typeof query.getAll === 'function') {
        return await query.getAll();
      }
      return await query.get();
    } catch (err) {
      console.warn(`Read failed (${listName}), retrying with select *:`, err);
      return readRecordsSimple(listName);
    }
  }

  async function readPaged(listName, options, onPage) {
    const opts = options || {};
    let query = getSp().web.lists.getByTitle(listName).items;
    if (opts.select && opts.select.length) query = query.select(...opts.select);
    if (opts.expand && opts.expand.length) query = query.expand(...opts.expand);
    if (opts.filter) query = query.filter(opts.filter);
    query = query.top(opts.top || CONFIG.pageSize);

    if (typeof query.getPaged !== 'function') {
      return readRecords(listName, options);
    }
    const all = [];
    let paged = await query.getPaged();
    while (true) {
      const batch = paged.results || [];
      all.push(...batch);
      if (onPage) onPage(batch.length, all.length);
      if (!paged.hasNext) break;
      paged = await paged.getNext();
    }
    return all;
  }

  async function listFields(listName) {
    const web = getWebUrl();
    const esc = String(listName).replace(/'/g, "''");
    const endpoint = `${web}/_api/web/lists/getbytitle('${esc}')/fields?$filter=FromBaseType eq false and Hidden eq false&$select=Title,InternalName,TypeAsString,Required,Hidden`;
    const res = await fetch(endpoint, {
      headers: { Accept: 'application/json;odata=nometadata' },
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
    const json = await res.json();
    const rows = (json.value || []).map((f) => ({
      Title: f.Title,
      InternalName: f.InternalName,
      Type: f.TypeAsString,
      Required: f.Required,
      Hidden: f.Hidden,
    }));
    console.table(rows);
    return rows;
  }

  async function getCurrentUser() {
    try {
      return await getSp().web.currentUser.get();
    } catch (err) {
      console.warn('Could not load current user', err);
      return null;
    }
  }

  async function ensureUser(loginOrEmail) {
    const login = String(loginOrEmail).trim();
    if (!login) return null;
    return getSp().web.ensureUser(login);
  }

  async function diagnoseLists() {
    const web = getWebUrl();
    const names = Object.entries(CONFIG.lists).map(([key, title]) => ({ key, title }));
    const report = { webUrl: web, lists: {} };
    for (const { key, title } of names) {
      try {
        const items = await readRecordsSimple(title);
        const sample = items[0] || null;
        report.lists[key] = {
          title,
          count: items.length,
          sampleFields: sample ? Object.keys(sample).sort() : [],
        };
        console.log(`[CyberEffortsTracker] ${title}: ${items.length} item(s)`);
        if (sample) console.log(`[CyberEffortsTracker] Sample keys for ${title}:`, report.lists[key].sampleFields);
      } catch (err) {
        report.lists[key] = { title, error: err.message || String(err) };
        console.error(`[CyberEffortsTracker] ${title} FAILED:`, err);
      }
    }
    console.table(
      Object.entries(report.lists).map(([k, v]) => ({
        list: k,
        title: v.title,
        count: v.count ?? '—',
        error: v.error ?? '',
      }))
    );
    return report;
  }

  CET.sp = {
    getWebUrl,
    getSp,
    createRecord,
    readRecords,
    readRecordsSimple,
    readPaged,
    updateRecord,
    deleteRecord,
    listFields,
    getCurrentUser,
    ensureUser,
  };

  CET.listFields = listFields;
  CET.diagnoseLists = diagnoseLists;
})(window.CyberEffortsTracker);
