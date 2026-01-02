export const DriveService = {
    tokenClient: null,
    accessToken: null,
    tokenExpiry: 0,  // Token expiry timestamp in milliseconds
    fileId: null,
    isConnected: false,
    lastSyncTime: null,  // Track last successful sync time
    _silentRefreshPromise: null,  // Track ongoing silent refresh

    // Token storage keys (NOT synced to cloud)
    TOKEN_KEY: 'g_access_token',
    TOKEN_EXPIRY_KEY: 'g_token_expiry',

    getCredentials() {
        return {
            clientId: localStorage.getItem('g_client_id'),
            apiKey: localStorage.getItem('g_api_key')
        };
    },

    // Get last sync time for display
    getLastSyncTime() {
        return this.lastSyncTime;
    },

    // Format sync time for display
    getFormattedSyncTime() {
        if (!this.lastSyncTime) return null;
        const date = new Date(this.lastSyncTime);
        return date.toLocaleString();
    },

    // Store token with expiry time in localStorage
    _storeToken(accessToken, expiresIn) {
        // expiresIn is in seconds, convert to timestamp
        const expiryTimestamp = Date.now() + (expiresIn * 1000);

        localStorage.setItem(this.TOKEN_KEY, accessToken);
        localStorage.setItem(this.TOKEN_EXPIRY_KEY, expiryTimestamp.toString());

        this.accessToken = accessToken;
        this.tokenExpiry = expiryTimestamp;

        console.log('Token stored, expires at:', new Date(expiryTimestamp).toLocaleString());
    },

    // Load token from localStorage
    _loadStoredToken() {
        const storedToken = localStorage.getItem(this.TOKEN_KEY);
        const storedExpiry = localStorage.getItem(this.TOKEN_EXPIRY_KEY);

        if (storedToken && storedExpiry) {
            this.accessToken = storedToken;
            this.tokenExpiry = parseInt(storedExpiry, 10);
            return true;
        }
        return false;
    },

    // Clear stored token
    _clearStoredToken() {
        localStorage.removeItem(this.TOKEN_KEY);
        localStorage.removeItem(this.TOKEN_EXPIRY_KEY);
        this.accessToken = null;
        this.tokenExpiry = 0;
    },

    // Check if token is valid (not expired)
    // Returns true if token exists and has at least 1 minute before expiry
    isTokenValid() {
        if (!this.accessToken || !this.tokenExpiry) {
            return false;
        }
        // Add 60 second buffer to ensure token doesn't expire during request
        const bufferMs = 60 * 1000;
        return Date.now() < (this.tokenExpiry - bufferMs);
    },

    // Ensure valid token before making API calls
    // This will silently refresh if needed
    async ensureValidToken() {
        // If token is still valid, we're good
        if (this.isTokenValid()) {
            console.log('Token is still valid');
            return true;
        }

        console.log('Token expired or missing, attempting silent refresh...');

        // Try silent refresh
        const refreshed = await this._silentRefreshToken();

        if (refreshed) {
            console.log('Silent token refresh successful');
            return true;
        }

        console.log('Silent refresh failed, need user interaction');
        return false;
    },

    // Attempt silent token refresh using prompt: 'none'
    _silentRefreshToken() {
        // If already refreshing, return existing promise
        if (this._silentRefreshPromise) {
            return this._silentRefreshPromise;
        }

        this._silentRefreshPromise = new Promise((resolve) => {
            if (!this.tokenClient) {
                console.log('TokenClient not initialized');
                this._silentRefreshPromise = null;
                resolve(false);
                return;
            }

            // Set up one-time callback for this refresh attempt
            const originalCallback = this.tokenClient.callback;

            this.tokenClient.callback = (tokenResponse) => {
                // Restore original callback
                this.tokenClient.callback = originalCallback;
                this._silentRefreshPromise = null;

                if (tokenResponse && tokenResponse.access_token) {
                    // Store new token with expiry
                    const expiresIn = tokenResponse.expires_in || 3600; // Default 1 hour
                    this._storeToken(tokenResponse.access_token, expiresIn);

                    // Update gapi client
                    gapi.client.setToken({ access_token: tokenResponse.access_token });

                    this.isConnected = true;
                    window.dispatchEvent(new CustomEvent('drive-connected'));
                    resolve(true);
                } else {
                    console.log('Silent refresh returned no token');
                    resolve(false);
                }
            };

            // Error callback for when silent refresh fails
            this.tokenClient.error_callback = (error) => {
                console.log('Silent refresh error:', error);
                this.tokenClient.callback = originalCallback;
                this._silentRefreshPromise = null;
                resolve(false);
            };

            try {
                // Request token silently (no popup)
                this.tokenClient.requestAccessToken({ prompt: 'none' });
            } catch (err) {
                console.error('Silent refresh request failed:', err);
                this.tokenClient.callback = originalCallback;
                this._silentRefreshPromise = null;
                resolve(false);
            }
        });

        return this._silentRefreshPromise;
    },

    async init() {
        const { clientId, apiKey } = this.getCredentials();
        if (!clientId || !apiKey) return false;

        return new Promise((resolve) => {
            if (window.gapi && window.google) {
                this._initGapi(apiKey, clientId, resolve);
            } else {
                const check = setInterval(() => {
                    if (window.gapi && window.google) {
                        clearInterval(check);
                        this._initGapi(apiKey, clientId, resolve);
                    }
                }, 100);
            }
        });
    },

    _initGapi(apiKey, clientId, resolve) {
        gapi.load('client', async () => {
            try {
                await gapi.client.init({
                    apiKey: apiKey,
                    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'],
                });

                // Restore Token from localStorage
                const hasStoredToken = this._loadStoredToken();

                if (hasStoredToken && this.isTokenValid()) {
                    // Token is still valid, use it
                    gapi.client.setToken({ access_token: this.accessToken });
                    this.isConnected = true;
                    console.log('Restored valid token from storage');
                    window.dispatchEvent(new CustomEvent('drive-connected'));
                } else if (hasStoredToken) {
                    // Token exists but expired, try silent refresh after tokenClient is ready
                    console.log('Stored token expired, will try silent refresh');
                }

                // Initialize TokenClient with proper callback
                this.tokenClient = google.accounts.oauth2.initTokenClient({
                    client_id: clientId,
                    scope: 'https://www.googleapis.com/auth/drive.file',
                    callback: (tokenResponse) => {
                        if (tokenResponse && tokenResponse.access_token) {
                            // Store token with expiry time
                            const expiresIn = tokenResponse.expires_in || 3600;
                            this._storeToken(tokenResponse.access_token, expiresIn);

                            // Update gapi client
                            gapi.client.setToken({ access_token: tokenResponse.access_token });

                            this.isConnected = true;
                            window.dispatchEvent(new CustomEvent('drive-connected'));
                        }
                    },
                });

                // If token was expired, try silent refresh now
                if (hasStoredToken && !this.isTokenValid()) {
                    const refreshed = await this._silentRefreshToken();
                    if (!refreshed) {
                        console.log('Silent refresh failed, user will need to login again');
                        this._clearStoredToken();
                    }
                }

                resolve(true);
            } catch (err) {
                console.error("GAPI Init Error", err);
                resolve(false);
            }
        });
    },

    async signIn() {
        if (!this.tokenClient) {
            const success = await this.init();
            if (!success) {
                window.dispatchEvent(new CustomEvent('toast', { detail: { message: "GAPI Missing", type: "error" } }));
                return;
            }
        }

        if (this.isConnected && this.isTokenValid()) {
            // Token still valid, no need to refresh
            console.log('Already connected with valid token');
            return;
        }

        if (this.isConnected || this.accessToken) {
            // Try silent refresh first
            const refreshed = await this._silentRefreshToken();
            if (refreshed) {
                console.log('Silent refresh successful');
                return;
            }
        }

        // Need user consent - first time login or session expired
        console.log('Requesting user consent');
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
    },

    async findFile() {
        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
        }

        try {
            const response = await gapi.client.drive.files.list({
                'pageSize': 1,
                'fields': "files(id, name)",
                'q': "name = 'myFodmap.json' and trashed = false"
            });
            const files = response.result.files;
            if (files && files.length > 0) {
                this.fileId = files[0].id;
                return this.fileId;
            }
        } catch (err) {
            console.error("Find File Error", err);
            // If auth error, mark as disconnected and throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                this._clearStoredToken();
                throw new Error('AUTH_EXPIRED');
            }
        }
        return null;
    },

    async downloadFile() {
        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
        }

        if (!this.fileId) await this.findFile();
        if (!this.fileId) return null; // No file exists yet, not an error

        try {
            const response = await gapi.client.drive.files.get({
                fileId: this.fileId,
                alt: 'media'
            });
            return response.body || response.result;
        } catch (err) {
            console.error("Download Error", err);
            // Check if it's an auth error - throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                this._clearStoredToken();
                throw new Error('AUTH_EXPIRED');
            }
            return null;
        }
    },

    // Get cloud data with timestamp for comparison
    async getCloudDataWithTimestamp() {
        const cloudData = await this.downloadFile();
        if (!cloudData) return null;

        try {
            let parsed;
            if (typeof cloudData === 'string') {
                parsed = JSON.parse(cloudData);
            } else {
                parsed = cloudData;
            }
            return {
                data: parsed,
                timestamp: parsed.lastModified || null
            };
        } catch (e) {
            console.error("Failed to parse cloud data", e);
            return null;
        }
    },

    async saveFile(contentString) {
        if (!this.isConnected) {
            console.log("Not connected to Drive, skipping cloud save");
            return false;
        }

        // Check if online
        if (!navigator.onLine) {
            console.log("Offline, skipping cloud save");
            return false;
        }

        // Ensure token is valid before making API call
        const tokenValid = await this.ensureValidToken();
        if (!tokenValid) {
            throw new Error('AUTH_EXPIRED');
        }

        if (!this.fileId) {
            await this.findFile();
        }

        const metadata = {
            name: 'myFodmap.json',
            mimeType: 'application/json'
        };

        // Create Multipart Body
        const boundary = '-------314159265358979323846';
        const delimiter = "\r\n--" + boundary + "\r\n";
        const close_delim = "\r\n--" + boundary + "--";

        const multipartRequestBody =
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            JSON.stringify(metadata) +
            delimiter +
            'Content-Type: application/json\r\n\r\n' +
            contentString +
            close_delim;

        try {
            if (this.fileId) {
                // Update (PATCH)
                await gapi.client.request({
                    path: '/upload/drive/v3/files/' + this.fileId,
                    method: 'PATCH',
                    params: { uploadType: 'multipart' },
                    headers: {
                        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                    },
                    body: multipartRequestBody
                });
            } else {
                // Create (POST)
                const response = await gapi.client.request({
                    path: '/upload/drive/v3/files',
                    method: 'POST',
                    params: { uploadType: 'multipart' },
                    headers: {
                        'Content-Type': 'multipart/related; boundary="' + boundary + '"'
                    },
                    body: multipartRequestBody
                });

                if (response.result && response.result.id) {
                    this.fileId = response.result.id;
                }
            }

            // Update last sync time
            this.lastSyncTime = new Date().toISOString();
            window.dispatchEvent(new CustomEvent('sync-completed', { detail: { time: this.lastSyncTime } }));
            console.log("Saved to Drive at:", this.lastSyncTime);
            return true;
        } catch (err) {
            console.error("Save Error", err);
            // Handle auth expiry - throw for re-login
            if (err.status === 401 || err.status === 403) {
                this.isConnected = false;
                this._clearStoredToken();
                throw new Error('AUTH_EXPIRED');
            }
            return false;
        }
    }
};
