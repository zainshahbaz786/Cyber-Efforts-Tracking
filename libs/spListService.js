/**
 * SharePoint List Service
 * Fetches data from SharePoint lists using PnPjs v3.0.10
 * @version 2.0.0
 */
(function(global) {
    'use strict';

    /**
     * List display titles → internal names we always merge into the grid when OData omits
     * empty/unset columns (so they still appear in headers, edit, and customize columns).
     */
    const LIST_EXTRA_VISIBLE_FIELDS = {
        'Site-Survey': ['CompanyLocation', 'LocalContentCertificate', 'PUN'],
        Design: ['PUN']
    };

    /**
     * Internal field names to exclude from the grid for a given list (columns removed in SharePoint).
     */
    const LIST_SUPPRESSED_INTERNAL_FIELDS = {
        Design: ['CompanyLocation', 'LocalContentCertificate']
    };

    const SPListService = {
        _initialized: false,
        _siteUrl: null,
        /** @type {Record<string, Record<string, string>>} listTitle -> internalName -> TypeAsString */
        _fieldTypeMapCache: Object.create(null),

        /**
         * Lowercased internal names that should appear in the app even when every cell is empty.
         * Used by app.js when building default visibleColumns.
         */
        getAlwaysVisibleInternalNamesForList(listName) {
            const arr = LIST_EXTRA_VISIBLE_FIELDS[listName] || [];
            return arr.map(s => String(s).toLowerCase());
        },

        /**
         * Append list-specific columns to allFields and ensure each raw item has the property
         * so rows/fieldMapping stay aligned (SharePoint often drops unset field keys).
         */
        _mergeExtraListFieldsIntoItems(items, listName, allFields, existingFieldsLower) {
            const extras = LIST_EXTRA_VISIBLE_FIELDS[listName];
            if (!extras || !extras.length || !items || !items.length) return;
            extras.forEach(internal => {
                const key = String(internal);
                if (!key || existingFieldsLower.has(key.toLowerCase())) return;
                allFields.push(key);
                existingFieldsLower.add(key.toLowerCase());
                items.forEach(it => {
                    if (it && !(key in it)) it[key] = null;
                });
            });
        },

        /**
         * Initialize PnPjs with the current site
         */
        async init() {
            if (this._initialized) return true;

            try {
                // Get site URL
                this._siteUrl = this._getSiteUrl();
                // console.log('SPListService: Site URL:', this._siteUrl);

                // Check if PnPjs is available (exposed as $pnp)
                if (typeof $pnp !== 'undefined' && $pnp.sp) {
                    // Configure PnPjs with the site URL
                    if (typeof $pnp.sp.setup === 'function') {
                        $pnp.sp.setup({
                            sp: {
                                baseUrl: this._siteUrl
                            }
                        });
                    } else {
                        // console.warn('SPListService: $pnp.sp.setup is not a function');
                    }
                    // console.log('SPListService: PnPjs initialized successfully');
                    this._initialized = true;
                    return true;
                } else {
                    // console.warn('SPListService: PnPjs ($pnp) not available, will use REST API fallback');
                    this._initialized = true;
                    return true;
                }

            } catch (error) {
                console.error('SPListService: Initialization failed:', error);
                // Still mark as initialized to allow REST fallback
                this._initialized = true;
                return true;
            }
        },

        /**
         * Fetch all items from a SharePoint list
         * @param {string} listName - Name of the SharePoint list
         * @param {number} itemLimit - Maximum items to fetch (default 5000)
         * @returns {Promise<{headers: string[], rows: any[][], listName: string}>}
         */
        async fetchListItems(listName, itemLimit = 5000) {
            if (!this._initialized) {
                await this.init();
            }

            // console.log(`SPListService: Fetching items from list "${listName}"...`);

            try {
                let items = [];

                // Try PnPjs first (only AttachmentFiles expand — list-specific Person fields vary by list)
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    // console.log('SPListService: Using PnPjs to fetch data...');
                    try {
                        items = await $pnp.sp.web.lists
                            .getByTitle(listName)
                            .items
                            .top(itemLimit)
                            .select('*', 'AttachmentFiles')
                            .expand('AttachmentFiles')
                            .get();
                        // console.log(`SPListService: PnPjs fetched ${items.length} items with attachments`);
                    } catch (pnpError) {
                        // console.warn('SPListService: PnPjs fetch failed, trying REST API:', pnpError);
                        items = await this._fetchViaREST(listName, itemLimit);
                    }
                } else {
                    // Fallback to REST API
                    // console.log('SPListService: Using REST API to fetch data...');
                    items = await this._fetchViaREST(listName, itemLimit);
                }

                // console.log(`SPListService: Total items fetched: ${items.length}`);

                // Ensure AttachmentFiles is populated for items with Attachments=true
                await this._ensureAttachmentFiles(items, listName);

                await this._logSharePointFieldDiagnostics(listName, items);

                // Convert to headers/rows format
                return this._convertToTableData(items, listName);

            } catch (error) {
                console.error('SPListService: Error fetching list items:', error);
                throw error;
            }
        },

        /**
         * Update an item in SharePoint list
         * @param {string} listName - Name of the SharePoint list
         * @param {number} itemId - ID of the item to update
         * @param {Object} updateData - Object with field names and values to update
         * @returns {Promise<boolean>} - True if successful
         */
        async updateListItem(listName, itemId, updateData) {
            if (!this._initialized) {
                await this.init();
            }

            const merged = await this.normalizeItemPayloadForRest(listName, updateData || {}, false, true);
            const id = parseInt(String(itemId), 10);
            if (!Number.isFinite(id) || id < 1) {
                throw new Error('Invalid SharePoint item id for update');
            }

            // Prefer PnPjs (same as addListItem): reliable PATCH/MERGE + correct field serialization.
            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    try {
                        await $pnp.sp.web.lists
                            .getByTitle(listName)
                            .items
                            .getById(id)
                            .update(merged);
                        return true;
                    } catch (pnpError) {
                        console.warn('SPListService: PnPjs update failed, trying REST:', pnpError);
                    }
                }
                return await this._updateViaREST(listName, id, merged);
            } catch (error) {
                console.error('SPListService: Error updating list item:', error);
                throw error;
            }
        },

        // ── Coordinator Ratings (multi-rating system) ───────────────────────────

        /**
         * Fetch all individual ratings from the CoordinatorRatings list for one
         * specific item in a main list.
         * Returns an array of { Rating, Feedback, RaterName } objects.
         */
        async fetchItemRatings(mainListName, mainItemId) {
            if (!this._initialized) await this.init();
            try {
                const siteUrl    = this._siteUrl || this._getSiteUrl();
                const safeListName = String(mainListName).replace(/'/g, "''");
                const url = `${siteUrl}/_api/web/lists/getbytitle('CoordinatorRatings')/items`
                    + `?$select=Rating,Feedback,RaterName/Title&$expand=RaterName`
                    + `&$filter=MainItemId eq ${mainItemId} and MainListName eq '${safeListName}'`
                    + `&$top=5000`;
                const res = await fetch(url, {
                    headers: { 'Accept': 'application/json;odata=verbose' },
                    credentials: 'include'
                });
                if (!res.ok) return [];
                const data = await res.json();
                return data?.d?.results || [];
            } catch (e) {
                // console.warn('SPListService: fetchItemRatings failed', e);
                return [];
            }
        },

        /**
         * Single batch load: all CoordinatorRatings rows for a main list — numeric
         * values for average recompute plus full rows for history UI (same shape as
         * fetchItemRatings per item).
         *
         * @param {string} mainListName
         * @returns {Promise<{ ratingsMap: Object.<number, number[]>, historyByItemId: Object.<number, Array> }>}
         */
        async fetchCoordinatorRatingsBundle(mainListName) {
            if (!this._initialized) await this.init();
            const empty = { ratingsMap: {}, historyByItemId: {} };
            try {
                const siteUrl      = this._siteUrl || this._getSiteUrl();
                const safeListName = String(mainListName).replace(/'/g, "''");
                const url = `${siteUrl}/_api/web/lists/getbytitle('CoordinatorRatings')/items`
                    + `?$select=MainItemId,Rating,Feedback,RaterName/Title&$expand=RaterName`
                    + `&$filter=MainListName eq '${safeListName}'`
                    + `&$top=5000`;
                const res = await fetch(url, {
                    headers: { 'Accept': 'application/json;odata=verbose' },
                    credentials: 'include',
                });
                if (!res.ok) return empty;
                const data  = await res.json();
                const items = data?.d?.results || [];

                const ratingsMap = {};
                const historyByItemId = {};
                items.forEach(item => {
                    const id = item.MainItemId;
                    if (id == null) return;
                    const r = parseFloat(item.Rating);
                    if (!isNaN(r)) {
                        if (!ratingsMap[id]) ratingsMap[id] = [];
                        ratingsMap[id].push(r);
                    }
                    if (!historyByItemId[id]) historyByItemId[id] = [];
                    historyByItemId[id].push(item);
                });
                return { ratingsMap, historyByItemId };
            } catch (e) {
                // console.warn('SPListService: fetchCoordinatorRatingsBundle failed', e);
                return empty;
            }
        },

        /**
         * Fetch every rating from the CoordinatorRatings list that belongs to a
         * given main list.  Returns a plain object keyed by MainItemId, where each
         * value is an array of numeric rating values.
         *
         * Used on app load to recompute averages so that manual edits / deletes
         * made directly in SharePoint are immediately reflected in the app.
         *
         * @param  {string} mainListName  Internal name of the parent list (e.g. "Design")
         * @returns {Promise<Object.<number, number[]>>} { [itemId]: [rating, rating, …] }
         */
        async fetchAllRatingsForList(mainListName) {
            const bundle = await this.fetchCoordinatorRatingsBundle(mainListName);
            return bundle.ratingsMap || {};
        },

        /**
         * Upsert a rating in the CoordinatorRatings list.
         *
         * If the current user already has a rating row for this item+list combination,
         * the existing row is updated (MERGE) — preventing duplicate records.
         * Otherwise a new row is created (POST).
         *
         * @param {{ MainItemId, MainListName, Rating, Feedback, RaterNameId }} payload
         * @returns {Promise<{ updated: boolean }>}
         */
        async addCoordinatorRating(payload) {
            if (!this._initialized) await this.init();
            const siteUrl      = this._siteUrl || this._getSiteUrl();
            const digest       = await this._getRequestDigest();
            if (!digest) throw new Error('Could not obtain request digest for rating save');

            const safeListName = String(payload.MainListName).replace(/'/g, "''");

            // ── Step 1: check whether this user has already rated this item ───────
            const checkUrl = `${siteUrl}/_api/web/lists/getbytitle('CoordinatorRatings')/items`
                + `?$select=Id`
                + `&$filter=MainItemId eq ${payload.MainItemId}`
                + ` and MainListName eq '${safeListName}'`
                + ` and RaterNameId eq ${payload.RaterNameId}`
                + `&$top=1`;

            const checkRes = await fetch(checkUrl, {
                headers:     { 'Accept': 'application/json;odata=verbose' },
                credentials: 'include',
            });
            if (!checkRes.ok) {
                const errText = await checkRes.text().catch(() => checkRes.statusText);
                throw new Error(`addCoordinatorRating (check) failed (${checkRes.status}): ${errText}`);
            }
            const checkData = await checkRes.json();
            const existing  = checkData?.d?.results?.[0];

            // ── Step 2a: update existing row ──────────────────────────────────────
            if (existing) {
                const updateRes = await fetch(
                    `${siteUrl}/_api/web/lists/getbytitle('CoordinatorRatings')/items(${existing.Id})`,
                    {
                        method: 'POST',
                        headers: {
                            'Accept':          'application/json',
                            'Content-Type':    'application/json',
                            'X-RequestDigest': digest,
                            'IF-MATCH':        '*',
                            'X-HTTP-Method':   'MERGE',
                        },
                        credentials: 'include',
                        body: JSON.stringify({
                            Rating:   payload.Rating,
                            Feedback: payload.Feedback,
                        }),
                    }
                );
                if (!updateRes.ok) {
                    const errText = await updateRes.text().catch(() => updateRes.statusText);
                    throw new Error(`addCoordinatorRating (update) failed (${updateRes.status}): ${errText}`);
                }
                return { updated: true, id: existing.Id };
            }

            // ── Step 2b: create new row ───────────────────────────────────────────
            const createRes = await fetch(
                `${siteUrl}/_api/web/lists/getbytitle('CoordinatorRatings')/items`,
                {
                    method: 'POST',
                    headers: {
                        'Accept':          'application/json',
                        'Content-Type':    'application/json',
                        'X-RequestDigest': digest,
                    },
                    credentials: 'include',
                    body: JSON.stringify(payload),
                }
            );
            if (!createRes.ok) {
                const errText = await createRes.text().catch(() => createRes.statusText);
                throw new Error(`addCoordinatorRating (create) failed (${createRes.status}): ${errText}`);
            }
            return { updated: false, ...(await createRes.json()) };
        },

        /**
         * Write the calculated average rating back to the AverageRating column on
         * the specified main list item so it is visible outside the app as well.
         */
        async updateAverageRating(mainListName, itemId, averageRating) {
            if (!this._initialized) await this.init();
            const siteUrl = this._siteUrl || this._getSiteUrl();
            const digest  = await this._getRequestDigest();
            if (!digest) throw new Error('Could not obtain request digest for average update');

            const encList = encodeURIComponent(mainListName).replace(/'/g, "''");
            const res = await fetch(
                `${siteUrl}/_api/web/lists/getbytitle('${encList}')/items(${itemId})`,
                {
                    method: 'POST',
                    headers: {
                        'Accept':          'application/json',
                        'Content-Type':    'application/json',
                        'X-RequestDigest': digest,
                        'IF-MATCH':        '*',
                        'X-HTTP-Method':   'MERGE',
                    },
                    credentials: 'include',
                    body: JSON.stringify({ AverageRating: String(averageRating) }),
                }
            );
            return res.ok;
        },

        // ── End Coordinator Ratings ─────────────────────────────────────────────

        /**
         * Load InternalName -> TypeAsString for a list (cached). Used to shape REST payloads.
         */
        async getFieldTypeMap(listName) {
            if (!this._initialized) await this.init();
            const key = String(listName);
            if (this._fieldTypeMapCache[key]) return this._fieldTypeMapCache[key];

            const siteUrl = this._siteUrl || this._getSiteUrl();
            const enc = encodeURIComponent(listName).replace(/'/g, "''");
            const url = `${siteUrl}/_api/web/lists/getbytitle('${enc}')/fields?$select=InternalName,TypeAsString,ReadOnlyField&$top=500`;

            const res = await fetch(url, {
                credentials: 'include',
                headers: { Accept: 'application/json;odata=verbose' }
            });
            if (!res.ok) {
                console.warn('SPListService: getFieldTypeMap failed', res.status);
                return {};
            }
            const data = await res.json();
            const rows = data.d?.results || data.value || [];
            const map = Object.create(null);
            rows.forEach(f => {
                if (f.InternalName && f.TypeAsString) map[f.InternalName] = f.TypeAsString;
            });
            this._fieldTypeMapCache[key] = map;
            return map;
        },

        /**
         * Resolve field type (case-insensitive internal name).
         */
        _getFieldTypeFromMap(typeMap, internalName) {
            if (!internalName || !typeMap) return null;
            if (typeMap[internalName]) return typeMap[internalName];
            const lower = String(internalName).toLowerCase();
            const found = Object.keys(typeMap).find(k => k.toLowerCase() === lower);
            return found ? typeMap[found] : null;
        },

        /**
         * Hyperlink / Picture columns need a real URL. If the user typed a bare email,
         * prefix mailto: so SharePoint accepts it (e.g. Design list contact columns).
         */
        _normalizeHyperlinkUrlString(raw) {
            const s = String(raw || '').trim();
            if (!s) return s;
            if (/^(https?|mailto|ftp|file|tel|fax):/i.test(s)) return s;
            // UNC network paths (\\server\share\folder\...)
            if (/^\\\\/.test(s)) return s;
            if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return `mailto:${s}`;
            return s;
        },

        /**
         * Convert flat string values into shapes SharePoint REST expects (URL → object, etc.).
         * @param {boolean} forVerbosePost - true when body uses odata=verbose + __metadata on nested objects
         * @param {boolean} isUpdate - when true, empty values are sent as explicit clears (SharePoint ignores omitted fields on MERGE/PATCH)
         */
        async normalizeItemPayloadForRest(listName, payload, forVerbosePost, isUpdate = false) {
            if (!payload || typeof payload !== 'object') return payload;
            let typeMap;
            try {
                typeMap = await this.getFieldTypeMap(listName);
            } catch (e) {
                return payload;
            }
            if (!typeMap || !Object.keys(typeMap).length) return payload;

            const out = { ...payload };

            for (const key of Object.keys(out)) {
                let t = this._getFieldTypeFromMap(typeMap, key);
                if (!t && /Id$/i.test(key)) {
                    t = this._getFieldTypeFromMap(typeMap, key.replace(/Id$/i, ''));
                }
                let val = out[key];

                if (t === 'Calculated' || t === 'Computed' || t === 'Counter') {
                    delete out[key];
                    continue;
                }

                const isEmpty = val === '' || val === null || val === undefined;

                // On create, drop empties. On update, SharePoint keeps old values unless we send an explicit clear.
                if (isEmpty && isUpdate) {
                    if (t === 'URL' || t === 'Image' || t === 'Thumbnail') {
                        const obj = { Url: '', Description: '' };
                        if (forVerbosePost) obj.__metadata = { type: 'SP.FieldUrlValue' };
                        out[key] = obj;
                        continue;
                    }
                    if (t === 'Number' || t === 'Currency') {
                        out[key] = null;
                        continue;
                    }
                    if (t === 'Boolean') {
                        out[key] = false;
                        continue;
                    }
                    if ((t === 'User' || t === 'Lookup') && /Id$/i.test(key)) {
                        out[key] = null;
                        continue;
                    }
                    if (t === 'User' && !/Id$/i.test(key)) {
                        const idKey = `${key}Id`;
                        if (this._getFieldTypeFromMap(typeMap, idKey)) {
                            delete out[key];
                            out[idKey] = null;
                        } else {
                            out[key] = '';
                        }
                        continue;
                    }
                    if (t === 'Lookup' && !/Id$/i.test(key)) {
                        const idKey = `${key}Id`;
                        delete out[key];
                        out[idKey] = null;
                        continue;
                    }
                    if (t === 'MultiChoice') {
                        out[key] = { results: [] };
                        continue;
                    }
                    if (t === 'TaxonomyFieldType' || t === 'TaxonomyFieldTypeMulti') {
                        delete out[key];
                        continue;
                    }
                    if (t === 'DateTime' || t === 'Date') {
                        out[key] = null;
                        continue;
                    }
                    out[key] = '';
                    continue;
                }

                if (isEmpty && !isUpdate) {
                    delete out[key];
                    continue;
                }

                if ((t === 'User' || t === 'Lookup') && /Id$/i.test(key)) {
                    if (typeof val === 'number' && Number.isFinite(val)) continue;
                    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
                        out[key] = parseInt(val.trim(), 10);
                    } else {
                        delete out[key];
                    }
                    continue;
                }

                if (t === 'URL' || t === 'Image' || t === 'Thumbnail') {
                    if (typeof val === 'string') {
                        let urlPart = val;
                        let descPart = '';
                        try {
                            const p = JSON.parse(val);
                            if (p && p.type === 'sp_hyperlink' && p.url) {
                                urlPart = p.url;
                                descPart =
                                    p.description != null && String(p.description).trim()
                                        ? String(p.description).trim()
                                        : '';
                            }
                        } catch (e) {
                            /* plain URL / free text */
                        }
                        const u = this._normalizeHyperlinkUrlString(urlPart);
                        if (u) {
                            const desc =
                                descPart.length > 0
                                    ? descPart.length > 255
                                        ? descPart.slice(0, 255)
                                        : descPart
                                    : u.length > 255
                                        ? u.slice(0, 255)
                                        : u;
                            const obj = { Url: u, Description: desc };
                            if (forVerbosePost) obj.__metadata = { type: 'SP.FieldUrlValue' };
                            out[key] = obj;
                        }
                    }
                    continue;
                }

                if (t === 'User') {
                    if (typeof val === 'number' && Number.isFinite(val)) {
                        const idKey = /Id$/i.test(key) ? key : `${key}Id`;
                        delete out[key];
                        out[idKey] = val;
                    } else if (typeof val === 'string') {
                        const id = parseInt(val.trim(), 10);
                        if (!isNaN(id) && String(id) === val.trim()) {
                            const idKey = /Id$/i.test(key) ? key : `${key}Id`;
                            delete out[key];
                            out[idKey] = id;
                        } else {
                            delete out[key];
                        }
                    } else {
                        delete out[key];
                    }
                    continue;
                }

                if (t === 'Lookup') {
                    if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
                        const idKey = /Id$/i.test(key) ? key : `${key}Id`;
                        delete out[key];
                        out[idKey] = parseInt(val.trim(), 10);
                    } else {
                        delete out[key];
                    }
                    continue;
                }

                if (t === 'Number' || t === 'Currency') {
                    const n = parseFloat(String(val).replace(/,/g, ''));
                    if (!isNaN(n)) out[key] = n;
                    continue;
                }

                if (t === 'Boolean') {
                    const s = String(val).toLowerCase();
                    out[key] = s === 'true' || s === 'yes' || s === '1';
                    continue;
                }

                if (t === 'MultiChoice' && typeof val === 'string') {
                    const parts = val.split(/[;,]/).map(x => x.trim()).filter(Boolean);
                    if (forVerbosePost) {
                        out[key] = { results: parts };
                    } else {
                        out[key] = { results: parts };
                    }
                    continue;
                }

                if (t === 'TaxonomyFieldType' || t === 'TaxonomyFieldTypeMulti') {
                    delete out[key];
                    continue;
                }
            }

            return out;
        },

        /**
         * Add a new item to a SharePoint list
         * @param {string} listName - Name of the SharePoint list
         * @param {Object} itemData - Object with display field names or internal names and values
         * @returns {Promise<Object>} - Created item/response
         */
        async addListItem(listName, itemData) {
            if (!this._initialized) {
                await this.init();
            }

            // console.log(`SPListService: Adding item to list "${listName}"...`, itemData);

            // Normalize keys: allow display names (e.g. "View Name") or internal names.
            const payload = {};
            for (const key of Object.keys(itemData || {})) {
                const val = itemData[key];
                // If key looks like an internal name (contains _x00) assume already internal
                const isInternal = /_x[0-9A-Fa-f]{4}_/.test(key) || /^[A-Za-z0-9_]+$/.test(key) && !key.includes(' ');
                const internal = isInternal ? key : this.encodeFieldName(key);
                payload[internal] = val;
            }

            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    try {
                        const forPnp = await this.normalizeItemPayloadForRest(listName, payload, false);
                        const res = await $pnp.sp.web.lists.getByTitle(listName).items.add(forPnp);
                        return res;
                    } catch (pnpError) {
                        const forRest = await this.normalizeItemPayloadForRest(listName, payload, true);
                        return await this._addViaREST(listName, forRest);
                    }
                } else {
                    const forRest = await this.normalizeItemPayloadForRest(listName, payload, true);
                    return await this._addViaREST(listName, forRest);
                }
            } catch (error) {
                console.error('SPListService: Error adding list item:', error);
                throw error;
            }
        },

        /**
         * Get raw list items with optional select/filter/top (returns array of items)
         * @param {string} listName
         * @param {Object} options { select: string[], filter: string, top: number }
         */
        async getListItemsRaw(listName, options = {}) {
            if (!this._initialized) {
                await this.init();
            }
            const top = options.top || 5000;
            const select = options.select || [];
            const filter = options.filter || '';

            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    let query = $pnp.sp.web.lists.getByTitle(listName).items.top(top);
                    if (select && Array.isArray(select) && select.length) query = query.select(...select);
                    if (filter && typeof query.filter === 'function') query = query.filter(filter);
                    const res = await query.get();
                    return res || [];
                } else {
                    // Fallback to REST (supports top; filter/select not implemented here)
                    return await this._fetchViaREST(listName, top);
                }
            } catch (e) {
                // console.warn('SPListService: getListItemsRaw failed, using REST fallback', e);
                return await this._fetchViaREST(listName, top);
            }
        },

        /**
         * Get list information (including EffectiveBasePermissions)
         * @param {string} listName
         * @returns {Promise<Object>}
         */
        async getListInfo(listName) {
            if (!this._initialized) await this.init();
            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    const info = await $pnp.sp.web.lists.getByTitle(listName).get();
                    return info;
                } else {
                    // REST fallback
                    const url = `${this._siteUrl}/_api/web/lists/getbytitle('${encodeURIComponent(listName)}')`;
                    const resp = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json;odata=verbose' } });
                    if (!resp.ok) throw new Error(`Failed to get list info (${resp.status})`);
                    const data = await resp.json();
                    return data?.d || data;
                }
            } catch (err) {
                // console.warn('SPListService: getListInfo failed', err);
                throw err;
            }
        },

        /**
         * Check whether the current user has Edit permission on the specified list.
         * Uses EffectiveBasePermissions.Low bit mask. Returns boolean.
         */
        async currentUserCanEdit(listName) {
            try {
                const info = await this.getListInfo(listName);
                const perms = info?.EffectiveBasePermissions || info?.EffectivePermissions || null;
                // EffectiveBasePermissions may be an object with Low/High
                const low = perms?.Low ?? perms?.low ?? null;
                const numericLow = low != null ? parseInt(low, 10) : null;
                // Permission bit for EditListItems is 0x00000004 (decimal 4)
                if (numericLow != null) {
                    return (numericLow & 0x00000004) !== 0;
                }
                // If we can't determine, default to false
                return false;
            } catch (err) {
                // console.warn('SPListService: currentUserCanEdit failed', err);
                return false;
            }
        },

        /**
         * Add item via REST API (fallback)
         */
        async _addViaREST(listName, payload) {
            const siteUrl = this._siteUrl || this._getSiteUrl();
            const encodedListName = encodeURIComponent(listName).replace(/'/g, "''");
            const apiUrl = `${siteUrl}/_api/web/lists/getbytitle('${encodedListName}')/items`;

            const digest = await this._getRequestDigest();
            if (!digest) {
                throw new Error('Could not obtain request digest for SharePoint add');
            }

            const body = {
                '__metadata': { 'type': await this._getListItemEntityType(listName) },
                ...payload
            };

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose',
                    'X-RequestDigest': digest
                },
                credentials: 'include',
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('SPListService: REST API Add Error:', response.status, errorText);
                throw new Error(`SharePoint Add Error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            // console.log('SPListService: Item added successfully via REST API', data);
            return data.d || data;
        },

        /**
         * Update item via SharePoint REST API (fallback)
         */
        async _updateViaREST(listName, itemId, updateData) {
            const siteUrl = this._siteUrl || this._getSiteUrl();
            const encodedListName = encodeURIComponent(listName).replace(/'/g, "''");
            const apiUrl = `${siteUrl}/_api/web/lists/getbytitle('${encodedListName}')/items(${itemId})`;

            const digest = await this._getRequestDigest();
            if (!digest) {
                throw new Error('Could not obtain request digest for SharePoint update');
            }

            // MERGE with OData nometadata — plain application/json is unreliable on SharePoint list items.
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=nometadata',
                    'Content-Type': 'application/json;odata=nometadata',
                    'X-RequestDigest': digest,
                    'IF-MATCH': '*',
                    'X-HTTP-Method': 'MERGE'
                },
                credentials: 'include',
                body: JSON.stringify(updateData || {})
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('SPListService: REST API Update Error:', response.status, errorText);
                throw new Error(`SharePoint Update Error: ${response.status} - ${errorText || response.statusText}`);
            }

            return true;
        },

        /**
         * Get the list item entity type for REST API updates
         */
        async _getListItemEntityType(listName) {
            try {
                const siteUrl = this._siteUrl || this._getSiteUrl();
                const encodedListName = encodeURIComponent(listName).replace(/'/g, "''");
                const apiUrl = `${siteUrl}/_api/web/lists/getbytitle('${encodedListName}')?$select=ListItemEntityTypeFullName`;

                const response = await fetch(apiUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json;odata=verbose'
                    },
                    credentials: 'include'
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.d?.ListItemEntityTypeFullName || 'SP.Data.ListItem';
                }
            } catch (e) {
                // console.warn('SPListService: Could not get entity type:', e);
            }
            return 'SP.Data.ListItem';
        },

        /**
         * Encode field name to SharePoint internal format
         * Converts spaces to _x0020_, etc.
         */
        encodeFieldName(displayName) {
            let encoded = displayName
                .replace(/ /g, '_x0020_')
                .replace(/-/g, '_x002d_')
                .replace(/\./g, '_x002e_')
                .replace(/&/g, '_x0026_')
                .replace(/#/g, '_x0023_')
                .replace(/%/g, '_x0025_')
                .replace(/\//g, '_x002f_')
                .replace(/\\/g, '_x005c_')
                .replace(/:/g, '_x003a_')
                .replace(/\*/g, '_x002a_')
                .replace(/\?/g, '_x003f_')
                .replace(/"/g, '_x0022_')
                .replace(/</g, '_x003c_')
                .replace(/>/g, '_x003e_')
                .replace(/\|/g, '_x007c_');
            return encoded;
        },

        /**
         * Delete an item from SharePoint list
         * @param {string} listName - Name of the SharePoint list
         * @param {number} itemId - ID of the item to delete
         * @returns {Promise<boolean>} - True if successful
         */
        async deleteListItem(listName, itemId) {
            if (!this._initialized) {
                await this.init();
            }

            // console.log(`SPListService: Deleting item ${itemId} from list "${listName}"...`);

            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    // console.log('SPListService: Using PnPjs to delete item...');
                    try {
                        await $pnp.sp.web.lists
                            .getByTitle(listName)
                            .items
                            .getById(itemId)
                            .delete();
                        // console.log('SPListService: Item deleted successfully via PnPjs');
                        return true;
                    } catch (pnpError) {
                        // console.warn('SPListService: PnPjs delete failed, trying REST API:', pnpError);
                        return await this._deleteViaREST(listName, itemId);
                    }
                } else {
                    // console.log('SPListService: Using REST API to delete item...');
                    return await this._deleteViaREST(listName, itemId);
                }

            } catch (error) {
                console.error('SPListService: Error deleting list item:', error);
                throw error;
            }
        },

        /**
         * Delete item via SharePoint REST API (fallback)
         */
        async _deleteViaREST(listName, itemId) {
            const siteUrl = this._siteUrl || this._getSiteUrl();
            const encodedListName = encodeURIComponent(listName).replace(/'/g, "''");
            const apiUrl = `${siteUrl}/_api/web/lists/getbytitle('${encodedListName}')/items(${itemId})`;

            // console.log('SPListService: REST API Delete URL:', apiUrl);

            const digest = await this._getRequestDigest();
            if (!digest) {
                throw new Error('Could not obtain request digest for SharePoint delete');
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json;odata=verbose',
                    'Content-Type': 'application/json;odata=verbose',
                    'X-RequestDigest': digest,
                    'IF-MATCH': '*',
                    'X-HTTP-Method': 'DELETE'
                },
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('SPListService: REST API Delete Error:', response.status, errorText);
                throw new Error(`SharePoint Delete Error: ${response.status} - ${response.statusText}`);
            }

            // console.log('SPListService: Item deleted successfully via REST API');
            return true;
        },

        /**
         * Fetch items via SharePoint REST API (fallback)
         */
        async _fetchViaREST(listName, itemLimit, extraExpands = []) {
            const siteUrl = this._siteUrl || this._getSiteUrl();
            
            // Build the API URL - include attachments and any additional expands
            const encodedListName = encodeURIComponent(listName).replace(/'/g, "''");
            const expandFields = ['AttachmentFiles', ...extraExpands].join(',');

            // For Person/Group fields in extraExpands, add $select sub-properties so
            // SharePoint returns the display name instead of a deferred navigation stub.
            const personExpands = extraExpands.filter(f => f !== 'AttachmentFiles');
            const selectParam  = personExpands.length > 0
                ? `&$select=*,${personExpands.map(f => `${f}/Title,${f}/Id,${f}/EMail`).join(',')}`
                : '';

            const apiUrl = `${siteUrl}/_api/web/lists/getbytitle('${encodedListName}')/items?$top=${itemLimit}&$expand=${expandFields}${selectParam}`;
            
            // console.log('SPListService: REST API URL:', apiUrl);

            // Get request digest for SharePoint
            const digest = await this._getRequestDigest();

            const headers = {
                'Accept': 'application/json;odata=verbose',
                'Content-Type': 'application/json;odata=verbose'
            };

            if (digest) {
                headers['X-RequestDigest'] = digest;
            }

            const response = await fetch(apiUrl, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('SPListService: REST API Error:', response.status, errorText);
                throw new Error(`SharePoint API Error: ${response.status} - ${response.statusText}`);
            }

            const data = await response.json();
            
            // Handle both OData verbose and nometadata formats
            let items = [];
            if (data.d && data.d.results) {
                items = data.d.results;
            } else if (data.value) {
                items = data.value;
            } else if (Array.isArray(data)) {
                items = data;
            }

            return items;
        },

        /**
         * Get request digest for SharePoint operations
         */
        async _getRequestDigest() {
            try {
                // Try to get from page context first
                if (typeof document !== 'undefined') {
                    const digestInput = document.getElementById('__REQUESTDIGEST');
                    if (digestInput && digestInput.value) {
                        return digestInput.value;
                    }
                }

                // Fetch new digest
                const siteUrl = this._siteUrl || this._getSiteUrl();
                const response = await fetch(`${siteUrl}/_api/contextinfo`, {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json;odata=verbose',
                        'Content-Type': 'application/json;odata=verbose'
                    },
                    credentials: 'include'
                });

                if (response.ok) {
                    const data = await response.json();
                    return data.d?.GetContextWebInformation?.FormDigestValue || null;
                }
            } catch (e) {
                // console.warn('SPListService: Could not get request digest:', e);
            }
            return null;
        },

        /**
         * Log one structured object per list: field schema + keys seen on items (for debugging columns).
         * @param {string} listName
         * @param {Array<Object>} items
         */
        async _logSharePointFieldDiagnostics(listName, items) {
            try {
                const schemaRows = await this._fetchListFieldSchemaRows(listName);
                const sample = items.slice(0, Math.min(50, items.length));
                const responseKeys = new Set();
                sample.forEach(it => Object.keys(it || {}).forEach(k => responseKeys.add(k)));
                const keysSorted = Array.from(responseKeys).sort();

                const keysMaybeMissingFromPayload = schemaRows
                    .filter(r => {
                        const internal = String(r.InternalName || '');
                        if (!internal) return false;
                        if (responseKeys.has(internal)) return false;
                        if (responseKeys.has(`${internal}Id`)) return false;
                        if (responseKeys.has(`${internal}StringId`)) return false;
                        return true;
                    })
                    .map(r => ({
                        Title: r.Title,
                        InternalName: r.InternalName,
                        Hidden: r.Hidden
                    }));

                const fieldsByInternalName = {};
                for (const r of schemaRows) {
                    if (r.InternalName) {
                        fieldsByInternalName[r.InternalName] = {
                            Title: r.Title,
                            Hidden: r.Hidden,
                            FieldTypeKind: r.FieldTypeKind
                        };
                    }
                }

                console.log('[SPListService] Table fields', {
                    listName,
                    fieldsByInternalName,
                    propertyKeysOnItems_sampleRows: keysSorted,
                    schemaFieldsNotInItemPayload: keysMaybeMissingFromPayload
                });
            } catch (e) {
                // console.warn('SPListService: field diagnostics failed', e);
            }
        },

        /**
         * @param {string} listName
         * @returns {Promise<Array<{ Title: string, InternalName: string, Hidden: boolean, FieldTypeKind: number }>>}
         */
        async _fetchListFieldSchemaRows(listName) {
            if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                try {
                    const fields = await $pnp.sp.web.lists
                        .getByTitle(listName)
                        .fields.select('Title', 'InternalName', 'Hidden', 'FieldTypeKind')
                        .get();
                    return (fields || []).map(f => ({
                        Title: f.Title,
                        InternalName: f.InternalName,
                        Hidden: !!f.Hidden,
                        FieldTypeKind: f.FieldTypeKind
                    }));
                } catch (e) {
                    // console.warn('SPListService: PnP fields fetch failed, trying REST', e);
                }
            }
            const siteUrl = this._siteUrl || this._getSiteUrl();
            const encoded = encodeURIComponent(listName).replace(/'/g, "''");
            const url = `${siteUrl}/_api/web/lists/getbytitle('${encoded}')/fields?$select=Title,InternalName,Hidden,FieldTypeKind&$top=500`;
            const resp = await fetch(url, {
                credentials: 'include',
                headers: { Accept: 'application/json;odata=verbose' }
            });
            if (!resp.ok) throw new Error(`Fields API ${resp.status}`);
            const data = await resp.json();
            const raw = data.d?.results || data.value || [];
            return raw.map(f => ({
                Title: f.Title,
                InternalName: f.InternalName,
                Hidden: !!f.Hidden,
                FieldTypeKind: f.FieldTypeKind
            }));
        },

        /**
         * Ensure AttachmentFiles is populated for items that have attachments but missing file list
         */
        async _ensureAttachmentFiles(items, listName) {
            const needsFetch = items.filter(item => {
                const hasAtt = item.Attachments === true;
                const files = Array.isArray(item.AttachmentFiles) ? item.AttachmentFiles : (item.AttachmentFiles?.results || []);
                return hasAtt && files.length === 0;
            });
            if (needsFetch.length === 0) return;

            const siteUrl = this._siteUrl || this._getSiteUrl();
            const encodedList = encodeURIComponent(listName).replace(/'/g, "''");

            for (const item of needsFetch) {
                const itemId = item.Id || item.ID || item.id;
                if (!itemId) continue;
                try {
                    const url = `${siteUrl}/_api/web/lists/getbytitle('${encodedList}')/items(${itemId})/AttachmentFiles`;
                    const res = await fetch(url, {
                        headers: { Accept: 'application/json;odata=verbose' },
                        credentials: 'include'
                    });
                    if (!res.ok) continue;
                    const data = await res.json();
                    const files = data.d?.results || data.value || [];
                    if (files.length > 0) {
                        item.AttachmentFiles = files;
                    }
                } catch (e) {
                    // console.warn('SPListService: Could not fetch attachments for item', itemId, e);
                }
            }
        },

        /**
         * Convert SharePoint items to headers/rows format
         */
        _convertToTableData(items, listName) {
            if (!items || items.length === 0) {
                return { headers: [], rows: [], listName, source: 'SharePoint' };
            }

            // Get all unique field names from items (excluding system fields)
            const systemFields = [
                'FileSystemObjectType', 'Id', 'ID', 'ServerRedirectedEmbedUri',
                'ServerRedirectedEmbedUrl', 'ContentTypeId', 'ComplianceAssetId',
                'OData__UIVersionString', 'GUID', 'odata.type', 'odata.id',
                'odata.etag', 'odata.editLink', '__metadata',
                'AuthorId', 'EditorId', 'FirstUniqueAncestorSecurableObject',
                'RoleAssignments', 'AttachmentFiles', 'ContentType', 'GetDlpPolicyTip',
                'FieldValuesAsHtml', 'FieldValuesAsText', 'FieldValuesForEdit',
                'File', 'Folder', 'LikedByInformation', 'ParentList', 'Properties',
                'Versions', 'Created', 'Modified', 'Author', 'Editor',
                'AttachmentFiles@odata.navigationLinkUrl', // Hide navigation link metadata
                'Activities' // Built-in SharePoint activity tracking field (not a list column)
            ];

            // Extract headers from first item (exclude system fields - case-insensitive)
            const systemFieldsLower = systemFields.map(s => String(s).toLowerCase());
            let allFields = Object.keys(items[0]).filter(key => {
                if (systemFields.includes(key)) return false;
                if (systemFieldsLower.includes(String(key).toLowerCase())) return false;
                if (key.toLowerCase() === 'activities') return false;
                if (key.startsWith('_') || key.startsWith('OData__') || key.startsWith('odata.')) return false;
                if (key.endsWith('StringId') || key.endsWith('Id')) return false;
                // Hide navigation link columns
                if (key.includes('@odata.navigationLinkUrl')) return false;
                return true;
            });

            // Convert internal field names to display names
            let headers = allFields.map(field => this._formatFieldName(field));

            // Filter out Activities by display name (catches any internal name variant)
            const excludeIdx = headers.findIndex(h => String(h || '').trim().toLowerCase() === 'activities');
            if (excludeIdx >= 0) {
                allFields = allFields.filter((_, i) => i !== excludeIdx);
                headers = headers.filter((_, i) => i !== excludeIdx);
            }

            // Synthesise Person/Group display columns from their *Id counterparts.
            // SharePoint always returns e.g. CoordinatorNameId even when $expand is missing
            // or the field has never been set. If the expanded object key (CoordinatorName)
            // is absent from allFields, add it so the column always appears in the table.
            // Values will be '' for rows where no person is set, and will be filled in by
            // _applyRatingLocally() after a rating is saved.
            const existingFieldsLower = new Set(allFields.map(f => f.toLowerCase()));
            // Scan the keys from the first few items to catch fields absent from items[0]
            const allItemKeys = new Set(Object.keys(items[0]));
            items.slice(0, Math.min(10, items.length)).forEach(it => Object.keys(it).forEach(k => allItemKeys.add(k)));

            allItemKeys.forEach(key => {
                if (!key.endsWith('Id') || key.endsWith('StringId')) return;
                const baseName = key.slice(0, -2); // CoordinatorNameId → CoordinatorName
                if (!baseName || existingFieldsLower.has(baseName.toLowerCase())) return;
                if (systemFields.includes(baseName) || systemFieldsLower.includes(baseName.toLowerCase())) return;
                if (baseName.startsWith('_') || baseName.startsWith('OData__')) return;
                // Only synthesise if at least one item has a numeric Id value (person/lookup)
                // OR if this is a known coordinator-related field (may never have been set yet).
                const isCoordinatorField = baseName.toLowerCase().includes('coordinator');
                const hasNumericId = items.some(it => typeof it[key] === 'number');
                if (!hasNumericId && !isCoordinatorField) return;
                allFields.push(baseName);
                existingFieldsLower.add(baseName.toLowerCase());
            });
            this._mergeExtraListFieldsIntoItems(items, listName, allFields, existingFieldsLower);

            const suppressed = LIST_SUPPRESSED_INTERNAL_FIELDS[listName];
            if (suppressed && suppressed.length) {
                const drop = new Set(suppressed.map(s => String(s).toLowerCase()));
                allFields = allFields.filter(f => !drop.has(String(f).toLowerCase()));
            }

            headers = allFields.map(field => this._formatFieldName(field));

            // Convert items to rows (array of arrays)
            const rows = items.map(item => {
                return allFields.map(field => {
                    let value = item[field];

                    // Special handling for Attachments - use AttachmentFiles if available
                    if (field === 'Attachments') {
                        const files = Array.isArray(item.AttachmentFiles)
                            ? item.AttachmentFiles
                            : (item.AttachmentFiles?.results || []);
                        if (files.length > 0) {
                            const origin = (typeof window !== 'undefined' && window.location?.origin) || '';
                            return JSON.stringify({
                                type: 'attachments',
                                files: files.map(att => {
                                    const name = att.FileName || att.fileName || att.Name || att.name || 'Attachment';
                                    let url = att.ServerRelativeUrl || att.serverRelativeUrl || att.Url || att.url || '';
                                    if (url && !url.startsWith('http') && !url.startsWith('//')) {
                                        url = origin + (url.startsWith('/') ? url : '/' + url);
                                    }
                                    return {
                                        name,
                                        url: url || '',
                                        size: att.FileSize || att.fileSize || att.Size || 0
                                    };
                                })
                            });
                        }
                    }

                    return this._formatFieldValue(value, field);
                });
            });

            return {
                headers,
                rows,
                listName,
                source: 'SharePoint',
                fieldMapping: allFields,
                rawItems: items
            };
        },

        /**
         * Format field value for display
         * Handles SharePoint complex field types (Hyperlink, Person, Lookup, etc.)
         */
        _formatFieldValue(value, fieldName) {
            if (value === null || value === undefined) return '';

            // Special handling for Attachments field
            if (fieldName === 'Attachments') {
                // Handle boolean values (true/false indicating if attachments exist)
                if (typeof value === 'boolean') {
                    return value ? JSON.stringify({ type: 'has_attachments', hasAttachments: true }) : '';
                }

                // Handle other formats (like attachment URLs as strings)
                if (typeof value === 'string' && value.trim()) {
                    let url = value.trim();
                    if (url && !url.startsWith('http') && !url.startsWith('//') && typeof window !== 'undefined' && window.location?.origin) {
                        url = window.location.origin + (url.startsWith('/') ? url : '/' + url);
                    }
                    return JSON.stringify({
                        type: 'attachment_url',
                        url
                    });
                }

                return '';
            }

            // Skip AttachmentFiles field as it's handled above
            if (fieldName === 'AttachmentFiles') {
                return null; // This will be filtered out
            }

            // Handle objects (SharePoint complex fields)
            if (typeof value === 'object') {
                // OData deferred navigation link — Person/Group or Lookup field was not expanded.
                // Treat as empty; the column will be populated once a rating/update is saved.
                if (value.__deferred) return '';

                // Hyperlink/Picture field — preserve URL and Description for UI (app renders display text + link)
                if (value.Url !== undefined) {
                    const url = value.Url != null ? String(value.Url).trim() : '';
                    const desc =
                        value.Description != null && String(value.Description).trim()
                            ? String(value.Description).trim()
                            : '';
                    return JSON.stringify({
                        type: 'sp_hyperlink',
                        url,
                        description: desc
                    });
                }
                // Lookup field
                if (value.LookupValue !== undefined) {
                    return value.LookupValue || '';
                }
                // Person field
                if (value.Title !== undefined) {
                    return value.Title || '';
                }
                if (value.Email !== undefined) {
                    return value.Email || '';
                }
                // Array (multi-value fields)
                if (Array.isArray(value)) {
                    return value.map(v => {
                        if (typeof v === 'object') {
                            return v.LookupValue || v.Title || v.Url || JSON.stringify(v);
                        }
                        return String(v);
                    }).join(', ');
                }
                // Other objects - try common properties
                if (value.results && Array.isArray(value.results)) {
                    return value.results.map(v => v.Title || v.LookupValue || v).join(', ');
                }
                // Fallback to JSON but try to extract useful info
                return JSON.stringify(value);
            }
            
            // Handle string values
            let str = String(value);
            
            // Clean up mailto: prefix for email fields
            if (str.startsWith('mailto:')) {
                str = str.replace('mailto:', '');
            }
            
            // Clean up tel: prefix for phone fields
            if (str.startsWith('tel:')) {
                str = str.replace('tel:', '');
            }
            
            return str;
        },

        /**
         * Format internal field name to display name
         * Decodes SharePoint encoded characters like _x0020_ (space), _x002d_ (hyphen), etc.
         */
        _formatFieldName(fieldName) {
            let name = fieldName;
            
            // Decode SharePoint encoded characters (_x00XX_ format)
            name = this._decodeSharePointFieldName(name);
            
            // Remove common prefixes
            name = name.replace(/^OData_/, '');
            
            // Convert camelCase or PascalCase to Title Case with spaces
            name = name.replace(/([a-z])([A-Z])/g, '$1 $2');
            name = name.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
            
            // Replace underscores with spaces (but not multiple)
            name = name.replace(/_+/g, ' ');
            
            // Capitalize first letter of each word
            name = name.replace(/\b\w/g, c => c.toUpperCase());
            
            // Clean up extra spaces
            name = name.replace(/\s+/g, ' ').trim();
            
            return name;
        },

        /**
         * Decode SharePoint internal field name encoding
         * SharePoint encodes special characters as _xXXXX_ where XXXX is hex code
         */
        _decodeSharePointFieldName(fieldName) {
            if (!fieldName) return fieldName;
            
            // Common SharePoint encoded characters mapping
            const encodings = {
                '_x0020_': ' ',   // Space
                '_x0021_': '!',   // Exclamation
                '_x0022_': '"',   // Double quote
                '_x0023_': '#',   // Hash
                '_x0024_': '$',   // Dollar
                '_x0025_': '%',   // Percent
                '_x0026_': '&',   // Ampersand
                '_x0027_': "'",   // Single quote
                '_x0028_': '(',   // Left parenthesis
                '_x0029_': ')',   // Right parenthesis
                '_x002a_': '*',   // Asterisk
                '_x002b_': '+',   // Plus
                '_x002c_': ',',   // Comma
                '_x002d_': '-',   // Hyphen/Minus
                '_x002e_': '.',   // Period
                '_x002f_': '/',   // Forward slash
                '_x003a_': ':',   // Colon
                '_x003b_': ';',   // Semicolon
                '_x003c_': '<',   // Less than
                '_x003d_': '=',   // Equals
                '_x003e_': '>',   // Greater than
                '_x003f_': '?',   // Question mark
                '_x0040_': '@',   // At sign
                '_x005b_': '[',   // Left bracket
                '_x005c_': '\\',  // Backslash
                '_x005d_': ']',   // Right bracket
                '_x005e_': '^',   // Caret
                '_x005f_': '_',   // Underscore
                '_x0060_': '`',   // Backtick
                '_x007b_': '{',   // Left brace
                '_x007c_': '|',   // Pipe
                '_x007d_': '}',   // Right brace
                '_x007e_': '~'    // Tilde
            };
            
            let decoded = fieldName;
            
            // Replace known encodings (case insensitive)
            for (const [encoded, char] of Object.entries(encodings)) {
                const regex = new RegExp(encoded, 'gi');
                decoded = decoded.replace(regex, char);
            }
            
            // Handle any remaining _xXXXX_ patterns dynamically
            decoded = decoded.replace(/_x([0-9a-fA-F]{4})_/g, (match, hex) => {
                return String.fromCharCode(parseInt(hex, 16));
            });
            
            return decoded;
        },

        /**
         * Check if current user is a member of a specific SharePoint group
         * @param {string} groupName - Name of the SharePoint group
         * @returns {Promise<boolean>} - True if user is a member
         */
        async isCurrentUserInGroup(groupName) {
            if (!this._initialized) {
                await this.init();
            }

            // console.log(`SPListService: Checking if current user is in group "${groupName}"...`);

            try {
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    // console.log('SPListService: Using PnPjs to check group membership...');
                    try {
                        const result = await $pnp.sp.web.siteGroups
                            .getByName(groupName)
                            .users
                            .get();

                        const currentUser = await $pnp.sp.web.currentUser.get();
                        const currentUserEmail = (currentUser.Email || currentUser.LoginName || '').toLowerCase();

                        const isMember = result.some(user => {
                            const userEmail = (user.Email || user.LoginName || '').toLowerCase();
                            return userEmail === currentUserEmail;
                        });

                        // console.log(`SPListService: User ${currentUserEmail} is ${isMember ? '' : 'NOT '}in group "${groupName}"`);
                        return isMember;
                    } catch (pnpError) {
                        // console.warn('SPListService: PnPjs group check failed, trying REST API:', pnpError);
                        return await this._checkGroupMembershipViaREST(groupName);
                    }
                } else {
                    // console.log('SPListService: Using REST API to check group membership...');
                    return await this._checkGroupMembershipViaREST(groupName);
                }
            } catch (error) {
                console.error('SPListService: Error checking group membership:', error);
                return false;
            }
        },

        /**
         * Check group membership via SharePoint REST API (fallback)
         */
        async _checkGroupMembershipViaREST(groupName) {
            const siteUrl = this._siteUrl || this._getSiteUrl();

            try {
                const currentUserUrl = `${siteUrl}/_api/web/currentuser?$select=Id,Email,LoginName`;
                const userResponse = await fetch(currentUserUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json;odata=verbose'
                    },
                    credentials: 'include'
                });

                if (!userResponse.ok) {
                    console.error('SPListService: Could not get current user');
                    return false;
                }

                const userData = await userResponse.json();
                const currentUserId = userData.d?.Id;
                const currentUserEmail = (userData.d?.Email || userData.d?.LoginName || '').toLowerCase();

                if (!currentUserId) {
                    console.error('SPListService: Could not get current user ID');
                    return false;
                }

                const encodedGroupName = encodeURIComponent(groupName).replace(/'/g, "''");
                const groupUrl = `${siteUrl}/_api/web/sitegroups/getbyname('${encodedGroupName}')/users`;

                const groupResponse = await fetch(groupUrl, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json;odata=verbose'
                    },
                    credentials: 'include'
                });

                if (!groupResponse.ok) {
                    // console.warn(`SPListService: Group "${groupName}" not found or access denied`);
                    return false;
                }

                const groupData = await groupResponse.json();
                const users = groupData.d?.results || [];

                const isMember = users.some(user => {
                    return user.Id === currentUserId ||
                           (user.Email || '').toLowerCase() === currentUserEmail ||
                           (user.LoginName || '').toLowerCase() === currentUserEmail;
                });

                // console.log(`SPListService: User is ${isMember ? '' : 'NOT '}in group "${groupName}" (REST API)`);
                return isMember;
            } catch (error) {
                // console.error('SPListService: REST API group check failed:', error);
                return false;
            }
        },

        /**
         * Get SharePoint site URL
         */
        _getSiteUrl() {
            // Prefer SharePoint page context if available
            if (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo.webAbsoluteUrl) {
                return _spPageContextInfo.webAbsoluteUrl;
            }

            // Use decoded pathname to handle encoded segments like "Site%20Assets"
            const rawPath = window.location.pathname || '/';
            let path = '';
            try { path = decodeURIComponent(rawPath); } catch (e) { path = rawPath; }

            // Well-known SharePoint system library/folder names that are NEVER subsites.
            // A second path segment matching one of these is part of the site collection root,
            // not a managed-path subsite, so we must not include it in the site URL.
            const systemFolders = new Set([
                'siteassets', 'sitepages', 'site pages', '_layouts', '_catalogs',
                'lists', '_api', 'style library', 'shared documents', 'pages',
                'documents', '_vti_bin', 'testing'
            ]);

            // Capture /sites/<siteCollection> and, only if the next segment is not a system
            // folder, treat it as a managed-path subsite.
            const sitesMatch = path.match(/^(\/sites\/[^/]+)(\/([^/]+))?/i);
            if (sitesMatch && sitesMatch[1]) {
                const siteCollection  = sitesMatch[1];
                const secondSegment   = (sitesMatch[3] || '').toLowerCase();
                if (secondSegment && !systemFolders.has(secondSegment)) {
                    // Looks like a real subsite – include both segments
                    return window.location.origin + siteCollection + '/' + sitesMatch[3];
                }
                return window.location.origin + siteCollection;
            }

            // As a last resort use origin
            return window.location.origin;
        },

        /**
         * Check if running in SharePoint context
         */
        isSharePointContext() {
            return typeof _spPageContextInfo !== 'undefined' || 
                   window.location.hostname.includes('sharepoint.com') ||
                   window.location.pathname.includes('/sites/');
        }
    };

    // Expose globally
    global.SPListService = SPListService;

})(window);
