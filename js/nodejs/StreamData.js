require('joose');
var Utils = require('./../app/Utils');
var url = "http://liveortung.de/triathlon/rest/stream"; 

var mmap;
Class("StreamData",
{
    has:
    {
        isStopped : {
            is:   "rw",
            init : false	
        }
    },
    //--------------------------------------
    methods:
    {
    	getEventData : function(event,track,callBackFnc) {
            mmap = {};
            var json=[];
            for (var i in track.participants) 
            {
            	var pp = track.participants[i];
            	//json.push({to : (new Date()).getTime()/*event.endTime.getTime()*/,from : event.startTime.getTime(),IMEI : pp.deviceId});
            	json.push({to : event.endTime.getTime(),from : event.startTime.getTime(),IMEI : pp.deviceId});
            	mmap[pp.deviceId]=pp;
            }
    		callBackFnc(url,json,this.processData);
    	},
    	 
        start : function(track,checker,pingInterval,callBackFnc)
        {
        	function doTick() 
        	{
        		if (this.isStopped)
        			return;
        		if (checker && !checker()) {
                    setTimeout(doTick,pingInterval*1000);
        			return;
        		}
                var json=[];
                var ctime = (new Date()).getTime();
                mmap = {};
                for (var i in track.participants) 
                {
                	var pp = track.participants[i];
                	json.push({to : ctime,from : pp.__startTime,IMEI : pp.deviceId});
                	mmap[pp.deviceId]=pp;
                }            
                callBackFnc(url,json,this.processData);
        	}
        	doTick();
        },
        
        processData : function(data) 
        {
        	console.log("Process data size = "+data.length);
        	for (var i in data) 
        	{
        		var e = data[i];
        		//console.log("PROCESS : "+JSON.stringify(e));
                var ctime = parseInt(e.EPOCH);
                if (!ctime)
                     continue;
        		var part = mmap[e.IMEI];
        		if (!part) {
        			console.log("WRONG IMEI in StreamData.js : "+e.IMEI);
        			continue;
        		} else {
        			var ns = ctime+1;
        			if (part.__startTime < ns)
        				part.__startTime=ns;
        		}
                delete e._id;
                delete e.TS;
                e.LON=parseInt(e.LON);
                e.LAT=parseInt(e.LAT);
                if (isNaN(e.LON) || isNaN(e.LAT))
                        continue;
                if (e.ALT)
                        e.ALT=parseFloat(e.ALT);
                if (e.TIME)
                        e.TIME=parseFloat(e.TIME);
                if (e.HRT)
                        e.HRT=parseInt(e.HRT);
                /*if (e.LON == 0 && e.LAT == 0)
                        continue;*/
                //----------------------------------
                var c = [e.LON / 1000000.0,e.LAT / 1000000.0];
                if (part && part.ping) {
                    console.log(" >>> "+part.code+" | "+(Math.round(part.getElapsed()*100.0*100.0)/100.0)+"%"+" | PING AT POS "+c[0]+" | "+c[1]+" | "+Utils.formatDateTimeSec(new Date(ctime))) ;
                    part.ping(c,e.HRT,false/*SOS*/,ctime,e.ALT,0/*overall rank*/,0/*groupRank*/,0/*genderRank*/);
                }
        	}
        } 
    }    
});


