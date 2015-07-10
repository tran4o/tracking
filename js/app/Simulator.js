require('joose');
var CONFIG = require('./Config');
Class("Simulator",
{
    //--------------------------------------
        // ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has:
        {
    },
    //--------------------------------------
        methods:
        {
                simulateParticipantSimple : function(part,trackInSeconds)
                {
                        var delay = 60*1000*60*2; // 2 hours delay
                        var reqdelay = 0; // 45*1000; // 45 secs req delay
                        var p0 = TRACK.route[0];
                        var randcoef = CONFIG.simulation.gpsInaccuracy * 0.0001 / WGS84SPHERE.haversineDistance(p0, [p0[0]+0.0001, p0[1]+0.0001]);
                        var stime = (new Date()).getTime();
                        var coef = TRACK.getTrackLength() / TRACK.getTrackLengthInWGS84();
                        part.startTime = (new Date()).getTime() - 10*60*1000; // 10 minutes before
                        setInterval(function(e)
                        {
                                var ctime = (new Date()).getTime();
                                var isTime = (ctime >= CONFIG.times.begin && ctime <= CONFIG.times.end);
                                if (!isTime)
                                        return;
                                /*var elapsed = ((ctime - stime)/1000.0)/trackInSeconds;
                                var pos = TRACK.getPositionFromElapsed(elapsed % 1.0);
                                var dist1 = (Math.random()*2.0-1.0) * randcoef;
                                var dist2 =  (Math.random()*2.0-1.0)  * randcoef;
                                var alt = 1000*Math.random();
                                var overallRank = parseInt(20*Math.random())+1;
                                var groupRank = parseInt(20*Math.random())+1;
                                var genderRank = parseInt(20*Math.random())+1;
                                //pos[0]+=dist1;
                                //pos[1]+=dist2;
                                part.ping(pos,80+Math.random()*10,false,ctime,alt,overallRank,groupRank,genderRank,elapsed);
                                if (0 == 0)
                                        return;*/
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
         }
});
