require('joose');
var Utils = require('./Utils');
var CONFIG = require('./Config');
var RBTree = require('bintrees').RBTree;

var cache = {};

Class("BackendStream",
{
    has:
    {
		url : {
			is : "rw",
			init : "node/stream"
		},
		track : {
			is : "rw"
		}
    },
    //--------------------------------------
    methods:
    {
    	toIndex : function(time) {
    		return Math.floor(time/1000/60/10);	// 10 min block    		
    	},
    	fromIndex : function(index){
    		return index *1000*60*10;	// 10 min block    		    		
    	},

    	liveSyncNow : function() 
    	{
    		var ctime = (new Date()).getTime();
    		if (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end) 
    		{
    			// live sync ok
    			var mmap = {};
                var btime = this.fromIndex(index);
                var etime = this.fromIndex(index+1);
                var json = [];
                for (var i in this.track.participants) 
                {
                	var pp = this.track.participants[i];
                	if (pp.isFavorite) 
                	{
                    	pp.__done=false;
                		mmap[pp.deviceId]=pp;
                    	//???????
                		var reft = this.fromIndex(this.toIndex(ctime));
                    	if (!pp.__startTime || pp.__startTime < reft)
                    		pp.__startTime=reft;
                    	json.push({start:pp.__startTime,end : ctime,imei:pp.deviceId});
                	}
                }
                function processData(data) 
                {
                	var cleared={};
                	for (var i in data) 
                	{
                		var pp = mmap[data[i].imei];
                		if (pp) {
                			if (data[i].timestamp+1 > pp.__startTime)
                				pp.__startTime=data[i].timestamp+1;                		
                			pp.__done=true;                			
                			pp.states.remove(data[i]);
                			pp.states.insert(data[i]);
                		}
                	}
                }
                if (!json.length)
                	return;
                $.ajax({
                    type: "POST",
                    url: this.url,
                    data: JSON.stringify(json),
                    contentType: "application/json; charset=utf-8",
                    dataType: "json",
                    success: function(data){
                        processData(data);
                    },
                    failure: function(errMsg) {
                        console.error("ERROR get data from backend "+errMsg)
                    }
              });
    		}
    	},
    	get : function(index,onResult) {
    		if (!this.track)
    			return {};
    		var res = cache[index];
    		if (res) {
    			onResult();
    		} else {
    			var mmap = {};
                var btime = this.fromIndex(index);
                var etime = this.fromIndex(index+1);
                var json = [];
                for (var i in this.track.participants) 
                {
                	var pp = this.track.participants[i];
                	if (pp.isFavorite) 
                	{
                    	pp.__done=false;
                		mmap[pp.deviceId]=pp;
                    	json.push({start:btime,end : etime,imei:pp.deviceId});
                	}
                }
                function processData(data) 
                {
        			//---------------------------------------
                	cache[index]=true;
                	for (var i in data) 
                	{
                		var pp = mmap[data[i].imei];
                		if (pp) {
                			pp.__done=true;
                			pp.states.remove(data[i]);
                			pp.states.insert(data[i]);
                			//---------------------------------------
                		}
                	}
                	onResult(data);
                }
                if (!json.length) {
                	cache[index]=true;
                	onResult([]);
                	return;
                }                
    			$.ajax({
                      type: "POST",
                      url: this.url,
                      data: JSON.stringify(json),
                      contentType: "application/json; charset=utf-8",
                      dataType: "json",
                      success: function(data){
                          processData(data);
                      },
                      failure: function(errMsg) {
                          console.error("ERROR get data from backend "+errMsg)
                      }
                });
    		}
    	},
    
        start : function(track)
        {    
        	// TODO ?? 
        	CONFIG.__skipParticipantHistoryClear=999;
        	this.setTrack(track);
        	setInterval(this.liveSyncNow,CONFIG.timeouts.streamDataInterval*1000)
        }
    }    
});
