require('joose');
var Utils = require('./Utils');
var CONFIG = require('./Config');
Class("StreamData",
{
    has:
    {
    },
    //--------------------------------------
    methods:
    {
        start : function(track)
        {
            var url = "http://liverank-portal.de/triathlon/rest/stream"; 
        	var delay = -(new Date()).getTimezoneOffset()*60*1000;		// 120 for gmt+2
        	for (var i in track.participants) 
        	{
        		var part = track.participants[i];
        		part.startTime = (new Date()).getTime() - 10*60*1000; 	// 10 minutes before;
        	}
        	//-------------------------------------------------------------------------        	
        	function doTick() 
        	{
                var json=[];
                var ctime = (new Date()).getTime();
                var mmap = {};
                for (var i in track.participants) 
                {
                	var pp = track.participants[i];
                	json.push({to : ctime-delay,from : pp.startTime-delay,IMEI : pp.deviceId});
                	//json.push({to : 900719925474099,from : 0,IMEI : pp.deviceId});
                	mmap[pp.deviceId]=pp;
                }
                function processData(data) 
                {
                	for (var i in data) 
                	{
                		var e = data[i];
                        var ctime = parseInt(e.EPOCH);
                        if (!ctime)
                                continue;
                        ctime+=delay;
                		var part = mmap[e.IMEI];
                		if (!part) {
                			console.log("WRONG IMEI in StreamData.js : "+e.IMEI);
                			continue;
                		} else {
                			var ns = ctime+1;
                			if (part.startTime < ns)
                				part.startTime=ns;
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
                        part.ping(c,e.HRT,false/*SOS*/,ctime,e.ALT,0/*overall rank*/,0/*groupRank*/,0/*genderRank*/);
                        console.log(part.code+" | PING AT POS "+c[0]+" | "+c[1]+" TIME="+ctime/1000.0+" | "+Utils.formatDateTimeSec(new Date(ctime))+" | DELAY = "+((new Date()).getTime()-ctime)/1000.0+" sec delay") ;
                	}
                }
                if (json.length) 
                {
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
                	    	console.log("ERROR "+errMsg)
                	    }
                	});
                }                		
                setTimeout(doTick,CONFIG.timeouts.streamDataInterval*1000);
        	}
        	doTick();
        },
	    legacy : function(part) 
	    {
	        var delay = 60*1000*60*2; // 2 hours delay
	        var reqdelay = 10*1000; // 45 secs req delay
	        var stime = (new Date()).getTime();
	        part.startTime = (new Date()).getTime() - 10*60*1000; // 10 minutes before
	        setInterval(function(e)
	        {
	                var ctime = (new Date()).getTime();
	                var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
	                if (!isTime)
	                        return;
	                function onData(data)
	                {
	                        if (!data.length)
	                                return;
	                        for (var i=0;i<data.length;i++)
	                        {
	                                var e = data[i];
	                                //----------------------------------
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
	                                var ctime = parseInt(e.EPOCH);
	                                if (!ctime)
	                                        continue;
	                                ctime+=delay;
	                                part.ping(c,80+Math.random()*10,false,ctime,100,0,0,0);
	                                console.log("PING AT POS "+c[0]+" | "+c[1]+" TIME="+ctime/1000.0+" | "+formatDate(new Date(ctime))+" "+formatTimeSec(new Date(ctime))+" | DELAY = "+((new Date()).getTime()-ctime)/1000.0+" sec delay") ;
	
	                        }
	                }
	                var url = "/triathlon/rest/raceRecord/"+part.getDeviceId()+"?from="+(part.startTime-delay-reqdelay)+"&to="+(ctime-delay-reqdelay);
	                $.getJSON(url, function(result)
	                {
	                        if (!(result instanceof Array) && result.data)
	                                result=result.data;
	                        if (result instanceof Array)
	                                onData(result);
	                        else{
	                                console.error("ERROR : "+JSON.stringify(result));
	                        }
	                });
	                part.startTime=ctime;
	        },CONFIG.simulation.pingInterval*1000);
	    }
    },
     
    
});
