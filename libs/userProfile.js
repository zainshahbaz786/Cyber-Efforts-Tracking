/**
 * SharePoint User Profile Helper
 * Fetches current user information from SharePoint
 */
(function(global) {
    'use strict';

    const SPUser = {
        _cache: null,

        /**
         * Fetch current user from SharePoint
         * @returns {Promise<{displayName: string, email: string, loginName: string, id: number}>}
         */
        async fetchCurrentUser() {
            if (this._cache) return this._cache;

            try {
                // Try PnPjs first if available ($pnp is the global from pnp-3.0.10.js)
                if (typeof $pnp !== 'undefined' && $pnp.sp && $pnp.sp.web) {
                    try {
                        const user = await $pnp.sp.web.currentUser.get();
                        this._cache = {
                            displayName: user.Title || 'User',
                            email: user.Email || '',
                            loginName: user.LoginName || '',
                            id: user.Id || 0
                        };
                        return this._cache;
                    } catch (pnpError) {
                        console.warn('SPUser: PnPjs fetch failed, using REST API:', pnpError);
                    }
                }

                // Fallback to REST API
                const siteUrl = this._getSiteUrl();
                const response = await fetch(`${siteUrl}/_api/web/currentuser`, {
                    method: 'GET',
                    headers: {
                        'Accept': 'application/json;odata=verbose'
                    },
                    credentials: 'include'
                });

                if (!response.ok) throw new Error('Failed to fetch user');

                const data = await response.json();
                const user = data.d;

                this._cache = {
                    displayName: user.Title || 'User',
                    email: user.Email || '',
                    loginName: user.LoginName || '',
                    id: user.Id || 0
                };

                return this._cache;

            } catch (error) {
                console.warn('SPUser: Could not fetch SharePoint user:', error);
                
                // Return fallback for development/non-SharePoint environments
                return {
                    displayName: 'Guest User',
                    email: '',
                    loginName: '',
                    id: 0
                };
            }
        },

        /**
         * Get cached user (sync) - returns null if not yet fetched
         */
        getCachedUser() {
            return this._cache;
        },

        /**
         * Clear cached user data
         */
        clearCache() {
            this._cache = null;
        },

        /**
         * Get SharePoint site URL
         */
        _getSiteUrl() {
            // Try to detect SharePoint site URL
            if (typeof _spPageContextInfo !== 'undefined' && _spPageContextInfo.webAbsoluteUrl) {
                return _spPageContextInfo.webAbsoluteUrl;
            }
            
            // Check for common SharePoint URL patterns
            const path = window.location.pathname;
            const match = path.match(/^(\/sites\/[^/]+)/i);
            if (match) {
                return window.location.origin + match[1];
            }

            // Default to origin
            return window.location.origin;
        },

        /**
         * Get user initials for avatar
         */
        getInitials(name) {
            if (!name) return '?';
            const parts = name.trim().split(/\s+/);
            if (parts.length >= 2) {
                return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            }
            return name.substring(0, 2).toUpperCase();
        }
    };

    // Expose globally
    global.SPUser = SPUser;

})(window);
