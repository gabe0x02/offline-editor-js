/*global indexedDB */
/**
 * Library for handling the storing of map tiles in IndexedDB.
 *
 * Author: Andy Gup (@agup)
 * Contributor: Javier Abadia (@javierabadia)
 */
define([],function()
{
    "use strict";
    var TilesStore = function()
    {
        /**
         * Internal reference to the local database
         * @type {null}
         * @private
         */
        this._db = null;

        var DB_NAME = "offline_tile_store";

        /**
         * Determines if indexedDB is supported
         * @returns {boolean}
         */
        this.isSupported = function(){

            if(!window.indexedDB && !window.openDatabase){
                return false;
            }

            return true;
        };
        var summary = {};
        summary.store_requests = 0;
        summary.store_success = 0;
        summary.store_failed = 0;
        summary.storing = 0;
        summary.stored = 0;
        summary.failed_lookups = 0;
        summary.success_lookup =0;
        
        var stored = {}; //boolean is a tile stored
        var storing = {}; 
        this.storedSize = function() {
          return summary.stored;
        };
        this.isStored = function(url, callback) {
          if(stored[url] !== undefined) {
            // console.log("CACHE HIT")
            callback(stored[url]);
          } else {
            this.retrieve(url, function(success, data){
              // console.log("STORED CACHE LOOKED UP", success, url);
              markStored(url, success, true);
              callback(success);
            });
          }
        };

        this.isStoring = function(url) {
          return storing[url];
        };

        this.getSummary = function() {
          return summary;
        }

        function markStoring(url, bool, success) {
          if(bool) { 
            summary.store_requests++;
            if(storing[url]) {
              console.warn("DOUBLE STORE DECTED", url);
            }
            storing[url] = true;
            summary.storing++;
          } else {
            storing[url] = false;
            summary.storing--;
            if(success) {
              summary.store_success++;
            }else {
              summary.store_failed++;
            }
          }
        }
        function markStored(url, bool, lookup) {
          if( bool ){
            if(storing[url]) {
              markStoring(url, false, true);              
            }
            if(!stored[url]) {
              summary.stored++;
            }            
            if(stored[url] === undefined && lookup) {
              summary.success_lookup++;
            }
            
            stored[url] = true;            
          } else {
            if(storing[url]) {
              markStoring(url, false, false);
            }
            if(stored[url] === undefined && lookup) {
              summary.failed_lookups++;
            } 
            if(stored[url] === true) {
              console.warn("STORED ITEM WAS DELETED", url);
            }
            stored[url] = false;
          }         
          
          if(summary.stored % 1000 === 0) {
            console.log("markStored", summary);
          }
        }


        /**
         * Adds an object to the database
         * @param urlDataPair
         * @param callback callback(boolean, err)
         */
        this.store = function(urlDataPair,callback)
        {
            var url = urlDataPair.url;          
            markStoring(url, true);
            // console.log("STORE TILE", urlDataPair);
            try
            {
                var transaction = this._db.transaction(["tilepath"],"readwrite");
                transaction.oncomplete = function() 
                {
                    // console.log("transaction opened");
                };

                transaction.onerror = function(event) {
                    console.log("FALIED: open indexdb transaction", event);
                    markStoring(url, false);
                    callback(false,event.target.error.message);
                };

                var objectStore = transaction.objectStore("tilepath");
                var request = objectStore.put(urlDataPair);
                request.onsuccess = function() 
                {                  
                  markStored(url, true);
                  // console.log("SUCCESS: add item to db " + event.target.result, summary);
                  callback(true);
                };
                request.onerror = function() 
                {
                  markStored(url, false);
                  console.log("FAILED: add item to db " + request.result, summary);
                  callback(false,event.target.error.message);
                };
                
            }
            catch(err)
            {
                markStoring(url, false);
                console.err("TilesStore: " + err.stack);
                callback(false, err.stack);
            }
        };

        /**
         * Retrieve a record.
         * @param url
         * @param callback
         */
        this.retrieve = function(/* String */ url,callback)
        {
            // console.log("RETRIVING INDEXEDDB", url);
            if(this._db !== null)
            {
                var objectStore = this._db.transaction(["tilepath"]).objectStore("tilepath");
                var request = objectStore.get(url);
                request.onsuccess = function(event)
                {
                    var result = event.target.result;
                    if(result === undefined)
                    {                      
                        callback(false,"not found");
                    }
                    else
                    {                      
                        callback(true,result);
                    }
                };
                request.onerror = function(err)
                {
                    console.log(err);
                    callback(false, err);
                };
            }
        };

        /**
         * Deletes entire database
         * @param callback callback(boolean, err)
         */
        this.deleteAll = function(callback)
        {
            if(this._db !== null)
            {
                var request = this._db.transaction(["tilepath"],"readwrite")
                    .objectStore("tilepath")
                    .clear();
                request.onsuccess = function()
                {
                    callback(true);
                };
                request.onerror = function(err)
                {
                    callback(false, err);
                };
            }
            else
            {
                callback(false,null);
            }
        };

        /**
         * Delete an individual entry
         * @param url
         * @param callback callback(boolean, err)
         */
        this.delete = function(/* String */ url,callback)
        {
            if(this._db !== null)
            {
                var request = this._db.transaction(["tilepath"],"readwrite")
                    .objectStore("tilepath")
                    .delete(url);
                request.onsuccess = function()
                {
                    callback(true);
                };
                request.onerror = function(err)
                {
                    callback(false, err);
                };
            }
            else
            {
                callback(false,null);
            }
        };

        /**
         * Retrieve all tiles from indexeddb
         * @param callback callback(url, img, err)
         */
        this.getAllTiles = function(callback)
        {
            if(this._db !== null){
                var transaction = this._db.transaction(["tilepath"])
                    .objectStore("tilepath")
                    .openCursor();

                transaction.onsuccess = function(event)
                {
                    var cursor = event.target.result;
                    if(cursor){
                        var url = cursor.value.url;
                        var img = cursor.value.img;
                        callback(url,img,null);
                        cursor.continue();
                    }
                    else
                    {
                        callback(null, null, "end");
                    }
                }.bind(this);
                transaction.onerror = function(err)
                {
                    callback(null, null, err);
                };
            }
            else
            {
                callback(null, null, "no db");
            }     
        };

        /**
         * Provides the size of database in bytes
         * @param callback callback(size, null) or callback(null, error)
         */
        this.usedSpace = function(callback){
            if(this._db !== null){
                var usage = { sizeBytes: 0, tileCount: 0 };

                var transaction = this._db.transaction(["tilepath"])
                    .objectStore("tilepath")
                    .openCursor();

                transaction.onsuccess = function(event){
                    var cursor = event.target.result;
                    if(cursor){
                        var storedObject = cursor.value;
                        var json = JSON.stringify(storedObject);
                        usage.sizeBytes += this._stringBytes(json);
                        usage.tileCount += 1;
                        cursor.continue();
                    }
                    else
                    {                        
                        callback(usage,null);
                    }
                }.bind(this);
                transaction.onerror = function(err)
                {
                    callback(null, err);
                };
            }
            else
            {
                callback(null,null);
            }
        };

        this._stringBytes = function(str) {            
            return str.length /**2*/ ;
        };

        this.init = function(callback)
        {
            var request = indexedDB.open(DB_NAME, 4);
            callback = callback || function(success) { console.log("TilesStore::init() success:", success); }.bind(this);

            request.onerror = function(event) 
            {
                console.log("indexedDB error: " + event.target.errorCode);
                callback(false,event.target.errorCode);
            }.bind(this);

            request.onupgradeneeded = function(event) 
            {
                var db = event.target.result;

                if( db.objectStoreNames.contains("tilepath")) 
                {
                    db.deleteObjectStore("tilepath");
                }            

                db.createObjectStore("tilepath", { keyPath: "url" });
            }.bind(this);

            request.onsuccess = function(event)
            {
                this._db = event.target.result;
                console.log("database opened successfully");
                callback(true);
            }.bind(this);
        };
    };
    return TilesStore;    
});
