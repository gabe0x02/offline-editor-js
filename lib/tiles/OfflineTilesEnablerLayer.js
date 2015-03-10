define([
    "dojo/query",
    "dojo/request",
    "dojo/_base/declare",
    "tiles/TilesCore",
    "tiles/base64utils",
    "tiles/TilesStore",
    "tiles/tilingScheme",
    "tiles/FileSaver",
    "esri/layers/LOD",
    "esri/geometry/Point",
    "esri/geometry/Extent",
    "esri/layers/TileInfo",
    "esri/SpatialReference",
    "esri/layers/TiledMapServiceLayer"
], function(query, request, declare,TilesCore,Base64Utils,TilesStore,TilingScheme,
            FileSaver,LOD,Point,Extent,TileInfo,SpatialReference,TiledMapServerLayer)
{
    "use strict";
    return declare("OfflineTilesEnablerLayer",[TiledMapServerLayer],{

        tileInfo: null,
        _imageType: "",
        _level: null, //current zoom level
        _minZoom: null,
        _maxZoom: null,
        _tilesCore:null,

        constructor:function(url,callback,state){
            if(this._isLocalStorage() === false){
                alert("OfflineTiles Library not supported on this browser.");
                callback(false);
            }

            this._tilesCore = new TilesCore();

            //For calculating minZoom and maxZoom
            Array.prototype.sortNumber = function(){return this.sort(function(a,b){return a - b;});};

            this._self = this;
            this._lastTileUrl = "";
            this._imageType = "";

            /* we add some methods to the layer object */
            /* we don't want to extend the tiled layer class, as it is a capability that we want to add only to one instance */
            /* we also add some additional attributes inside an "offline" object */

            this._getTileUrl = this.getTileUrl;

            var isOnline = true;
            if(typeof state != "undefined" || state != null){
                isOnline = state;
                console.log("STATE IS: " + state);
            }

            this.offline = {
                online: isOnline,
                store: new TilesStore(),
                proxyPath: null//"../lib/resource-proxy/proxy.php"
            };

            if( /*false &&*/ this.offline.store.isSupported() )
            {
              console.log("INITING OFFLINE STORE");
                this.offline.store.init(function(success){
                    if(success){
                        this._getTileInfoPrivate(url,function(result){

                            // Store the layerInfo locally so we have it when browser restarts or is reloaded.
                            // We need this info in order to properly rebuild the layer.
                            if(localStorage.__offlineTileInfo === undefined && result !== false){
                                localStorage.__offlineTileInfo = result;
                            }

                            // If library is offline then attempt to get layerInfo from localStorage.
                            if(this.offline.online === false && result === false && localStorage.__offlineTileInfo !== undefined){
                                result = localStorage.__offlineTileInfo;
                            }
                            else if(this.offline.online === false && result === false && localStorage.__offlineTileInfo === undefined){
                                alert("There was a problem retrieving tiled map info in OfflineTilesEnablerLayer.");
                            }

                            this._tilesCore._parseGetTileInfo(result,function(tileResult){
                                this.layerInfos = tileResult.resultObj.layers;
                                this.minScale = tileResult.resultObj.minScale;
                                this.maxScale = tileResult.resultObj.maxScale;
                                this.tileInfo = tileResult.tileInfo;
                                this._imageType = this.tileInfo.format.toLowerCase();
                                this.fullExtent = tileResult.fullExtent;
                                this.spatialReference = this.tileInfo.spatialReference;
                                this.initialExtent = tileResult.initExtent;
                                this.loaded = true;
                                this.onLoad(this);
                                callback(true);
                            }.bind(this._self));
                        }.bind(this._self));
                    } else {
                      console.log("COULD NTO CREATE OFFLINE STORE>>>>>");
                    }
                }.bind(this._self));
            }
            else
            {
                return callback(false, "indexedDB not supported");
            }
        },

        /**
         * Internal method that overrides the getTileUrl() method.
         * If application is offline then tiles are written to IndexedDB.
         * Retrieves tiles as requested by the ArcGIS API for JavaScript.
         * If a tile is in cache it is returned.
         * If it is not in cache then one is retrieved over the internet.
         * @param level
         * @param row
         * @param col
         * @returns {String} URL
         */
        getTileUrl: function(level,row,col)
        {
            console.assert(!isNaN(level) && !isNaN(row) && !isNaN(col), "bad tile requested");
            // console.debug("looking for tile",level,row,col);

            this._level = level;

            var url = this.url + "/tile/" + level + "/" + row + "/" + col;
            // console.log("LIBRARY ONLINE " + this.offline.online)
            if( this.offline.online )
            {
                // console.debug("fetching url online: ", url);
                this._lastTileUrl = url;
                return url;
            }

            url = url.split("?")[0];

            /* temporary URL returned immediately, as we haven't retrieved the image from the indexeddb yet */
            var tileid = "void:/"+level+"/"+row+"/"+col;
            var img = null;
            this._tilesCore._getTiles(img,this._imageType,url,tileid,this.offline.store);

            return tileid;
        },

        /**
         * Utility method to get the basemap layer reference
         * @param map
         * @returns {Number} layerId
         */
        getBasemapLayer: function(map)
        {
            var layerId = map.layerIds[0];
            return map.getLayer(layerId);
        },

        /**
         * Returns an object that contains the number of tiles that would need to be downloaded
         * for the specified extent and zoom level, and the estimated byte size of such tiles.
         * This method is useful to give the user an indication of the required time and space
         * before launching the actual download operation. The byte size estimation is very rough.
         * @param extent
         * @param level
         * @param tileSize
         * @returns {{level: *, tileCount: Number, sizeBytes: number}}
         */
        getLevelEstimation: function(extent, level, tileSize)
        {
            var tilingScheme = new TilingScheme(this);
            var cellIds = tilingScheme.getAllCellIdsInExtent(extent,level);

            var levelEstimation = {
                level: level,
                tileCount: cellIds.length,
                sizeBytes: cellIds.length * tileSize
            };

            return levelEstimation;
        },

        /**
         * Returns the current zoom level
         * @returns {number}
         */
        getLevel: function(){
            return this._level;
        },

        /**
         * Returns the maximum zoom level for this layer
         * @param callback number
         */
        getMaxZoom: function(callback){

            if(this._maxZoom == null){
                var lods = this.tileInfo.lods;
                var length = this.tileInfo.lods.length;
                var tempArr = [];
                for(var i=0; i < length; i++){
                    tempArr.push(lods[i].level);
                    if(i == length -1){
                        tempArr.sortNumber();
                        this._maxZoom = tempArr[i];
                        callback(tempArr[i]);
                    }
                }
            }
            else{
                callback(this._maxZoom);
            }

        },

        /**
         * Returns the minimum zoom level for this layer
         * @param callback number
         */
        getMinZoom: function(callback){

            if(this._minZoom == null){
                var lods = this.tileInfo.lods;
                var length = this.tileInfo.lods.length;
                var tempArr = [];
                for(var i=0; i < length; i++){
                    tempArr.push(lods[i].level);
                    if(i == length -1){
                        tempArr.sortNumber();
                        this._minZoom = tempArr[0];
                        callback(tempArr[0]);
                    }
                }
            }
            else{
                callback(this._minZoom);
            }
        },

        /**
         * Retrieves tiles and stores them in the local cache.
         * @param minLevel
         * @param maxLevel
         * @param extent
         * @param reportProgress
         */
        prepareForOffline : function(minLevel, maxLevel, extent, reportProgress)
        {
            this._tilesCore._createCellsForOffline(this,minLevel,maxLevel,extent,function(cells){
                /* launch tile download */
                this._doNextTile(0, cells, reportProgress);
            }.bind(this));
        },

        /**
         * This method puts the layer in offline mode. When in offline mode,
         * the layer will not fetch any tile from the remote server. It
         * will look up the tiles in the indexed db database and display them in the
         * If the tile can't be found in the local database it will show up blank
         * (even if there is actual connectivity). The pair of methods goOffline() and
         * goOnline()allows the developer to manually control the behaviour of the
         * Used in conjunction with the offline dectection library, you can put the layer in
         * the appropriate mode when the offline condition changes.
         */
        goOffline : function()
        {
            this.offline.online = false;
        },

        /**
         * This method puts the layer in online mode. When in online mode, the layer will
         * behave as regular layers, fetching all tiles from the remote server.
         * If there is no internet connectivity the tiles may appear thanks to the browsers cache,
         * but no attempt will be made to look up tiles in the local database.
         */
        goOnline : function()
        {
            this.offline.online = true;
            this.refresh();
        },

        /**
         * Determines if application is online or offline
         * @returns {boolean}
         */
        isOnline : function()
        {
            return this.offline.online;
        },

        /**
         * Clears the local cache of tiles.
         * @param callback callback(boolean, errors)
         */
        deleteAllTiles : function(callback) // callback(success) or callback(false, error)
        {
            var store = this.offline.store;
            store.deleteAll(callback);
        },

        /**
         * Gets the size in bytes of the local tile cache.
         * @param callback  callback(size, error)
         */
        getOfflineUsage : function(callback) // callback({size: <>, tileCount: <>}) or callback(null,error)
        {
            var store = this.offline.store;
            store.usedSpace(callback);
        },

        /**
         * Gets polygons representing all cached cell ids within a particular
         * zoom level and bounded by an extent.
         * @param callback callback(polygon, error)
         */
        getTilePolygons : function(callback)	// callback(Polygon polygon) or callback(null, error)
        {
            this._tilesCore._getTilePolygons(this.offline.store,this.url,this,callback);
        },

        /**
         * Saves tile cache into a portable csv format.
         * @param fileName
         * @param callback callback( boolean, error)
         */
        saveToFile : function(fileName, callback) // callback(success, msg)
        {
            this._tilesCore._saveToFile(fileName,this.offline.store,callback);
        },

        /**
         * Reads a csv file into local tile cache.
         * @param file
         * @param callback callback( boolean, error)
         */
        loadFromFile : function(file, callback) // callback(success,msg)
        {
            console.log("reading",file);
            this._tilesCore._loadFromFile(file,this.offline.store,callback);
        },

        /**
         * Makes a request to a tile url and uses that as a basis for the
         * the average tile size.
         * Future Iterations could call multiple tiles and do an actual average.
         * @param callback
         * @returns {Number} Returns NaN if there was a problem retrieving the tile
         */
        estimateTileSize : function(callback)
        {
            this._tilesCore._estimateTileSize(this._lastTileUrl,this.offline.proxyPath,callback);
        },

        /**
         * Helper method that returns a new extent buffered by a given measurement that's based on map units.
         * E.g. If you are using mercator then buffer would be in meters
         * @param buffer
         * @returns {Extent}
         */
        getExtentBuffer : function(/* int */ buffer, /* Extent */ extent){
            extent.xmin -= buffer; extent.ymin -= buffer;
            extent.xmax += buffer; extent.ymax += buffer;
            return extent;
        },

        /**
         * Helper method that returns an array of tile urls within a given extent and level
         * @returns Array
         */
        getTileUrlsByExtent : function(extent,level){
            var tilingScheme = new TilingScheme(this);
            var level_cell_ids = tilingScheme.getAllCellIdsInExtent(extent,level);
            var cells = [];

            level_cell_ids.forEach(function(cell_id)
            {
                cells.push(this.url + "/" + level + "/" + cell_id[1] + "/" + cell_id[0]);
            }.bind(this));

            return cells;
        },

        /* internal methods */

        _doNextTile : function(i, cells, reportProgress)
        {            
            var cell = cells[i];
            var url = this._getTileUrl(cell.level,cell.row,cell.col);
            var offline_layer = this;
            function finishTile(success, error) {
              var cancelRequested = reportProgress({countNow:i, countMax:cells.length, cell: cell, url: url, success: success, error: error, finishedDownloading:false});

              if( cancelRequested || i === cells.length-1 )
              {
                  reportProgress({ finishedDownloading: true, cancelRequested: cancelRequested, success: success});
              }
              else
              {
                  offline_layer._doNextTile(i+1, cells, reportProgress);
              }
            }
            var store = this.offline.store;
            store.isStored(url, function(stored){
              if(!stored) {
                if(store.isStoring(url) || offline_layer._tilesCore._downloading(url)) {
                  // console.log("STORING IN PROGRESSS SKIP", url);
                  finishTile(true, 'tile already in progress');
                } else {
                  // console.log("Download Tile", url);
                  offline_layer._tilesCore._storeTile(url,offline_layer.offline.proxyPath, store,function(success, error)
                  {
                      if(!success)
                      {
                          console.log("error storing tile", cell, error);
                          error = { cell:cell, msg:error};
                      }
                      finishTile(success, error);
                  });
                }
              } else {
                // console.log("ALREADY STORED", url);
                finishTile(true, 'tile already stored');
              }
            });
        },

        /**
         * Test for localStorage functionality
         * @returns {boolean}
         * @private
         */
        _isLocalStorage: function(){
            var test = "test";
            try {
                localStorage.setItem(test, test);
                localStorage.removeItem(test);
                return true;
            } catch(e) {
                return false;
            }
        },

        /**
         * Attempts an http request to verify if app is online or offline.
         * Use this in conjunction with the offline checker library: offline.min.js
         * @param callback
         */
        _getTileInfoPrivate: function(url, callback){
            var req = new XMLHttpRequest();
            url = this.offline.proxyPath? this.offline.proxyPath + "?" + url + "?f=pjson" : url + "?f=pjson";
            req.open("GET", url, true);
            req.onload = function()
            {
                if( req.status === 200 && req.responseText !== "")
                {
                    if (this!=null) {
                        callback(this.response);
                    }else{
                        console.log("_getTileInfoPrivate failed");
                        callback(false);       
                    }
                }
                else
                {
                    console.log("_getTileInfoPrivate failed");
                    callback(false);
                }
            };
            req.onerror = function(e)
            {
                console.log("_getTileInfoPrivate failed: " + e);
                callback(false);
            };
            req.send(null);
        }
    }); // declare
}); // define
