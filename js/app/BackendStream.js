require('joose');
var Utils = require('./Utils');
var CONFIG = require('./Config');
Class("BackendStream",
{
    has:
    {
		url : {
			is : "rw",
			init : (window.location.host.indexOf("localhost") == 0 || window.location.host.indexOf("127.0.0.1") == 0) ? "http://localhost:3000/stream" : "node/stream"
		},
    },
    //--------------------------------------
    methods:
    {
        start : function(track)
        {    
        	track.test1();
        	// TEST
        	if (0 == 1) 
        	{
        		var ctime = (new Date()).getTime();
        		var cc=0;
        		setInterval(function() 
        		{
        			cc++;
                    for (var i in track.participants) 
                    {
                    	var diff = ((new Date()).getTime()-ctime)/1000; // seconds
        				var elp = cc/60.0;  
                    	if (elp > 1)
                    		elp=1;
                    	var pp = track.participants[i];
                    	//var pos = track.__getPositionAndRotationFromElapsed(elp);
                    	var pos = track.getPositionAndRotationFromElapsed(elp);
                    	pp.pingCalculated(
                    	  {
                    	        "imei": "1000",
                    	        "speed": 0,
                    	        "elapsed": 0,
                    	        "timestamp": (new Date()).getTime(),
                    	        "gps": [Math.round(pos[0]*1000000.0)/1000000.0,Math.round(pos[1]*1000000.0)/1000000.0],
                    	        "freq": 0,
                    	        "isSOS": false,
                    	        "acceleration": 0,
                    	        "alt": 0,
                    	        "overallRank": 1,
                    	        "genderRank": 1,
                    	        "groupRank": 1
                    	    });
                    }
        		},3000);
        		return;
        	}
        	//-------------------------------------------------------------------------        	
    		var delay = -(new Date()).getTimezoneOffset()*60*1000;	// 120 for gmt+2
    		var url = this.url;
        	function doTick() 
        	{
                var mmap = {};
                var ctime = (new Date()).getTime();
                var json = [];
                for (var i in track.participants) 
                {
                	var pp = track.participants[i];
                	if (pp.isFavorite)
                		mmap[pp.deviceId]=pp;
                	var reft = ctime - 10*60*1000;
                	if (!pp.__startTime || pp.__startTime < reft) {
                		pp.__startTime=reft;
                	}
                	json.push({start:pp.__startTime-delay,end : ctime-delay,imei:pp.deviceId});
                }
                if (!json.length)
                	return;
                function processData(data) 
                {
                	for (var i in data) 
                	{
                		data[i].timestamp+=delay;
                		//console.warn(data[i]);
                		var pp = mmap[data[i].imei];
                		if (pp) {
                			if (data[i].timestamp+1 > pp.__startTime)
                				pp.__startTime=data[i].timestamp+1;
                			pp.pingCalculated(data[i]);
                		}
                	}
                }
                //console.log(json);
                $.ajax({
                    type: "POST",
                    url: url,
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
                setTimeout(doTick,CONFIG.timeouts.streamDataInterval*1000);
        	}
        	doTick();
        }
    }    
});
