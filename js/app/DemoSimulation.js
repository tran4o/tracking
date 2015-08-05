var Utils = require('./Utils');
var CONFIG = require('./Config');

var DemoSimulation = function() {

    console.info("Starting demo simulation");

    var scoef = 6*5*5*3; //5*4;//*3;//*3;//4.729;

    // keep track of all the simulation participants
    var countSimulations = 0;

    this.simulateParticipant = function(part) {

        var trackInSeconds = 30*scoef*(1+countSimulations/7.0);
        countSimulations++;

        var p0 = TRACK.route[0];
        var randcoef = CONFIG.simulation.gpsInaccuracy * 0.0001 / Utils.WGS84SPHERE.haversineDistance(p0, [p0[0]+0.0001, p0[1]+0.0001]);
        var stime = (new Date()).getTime();
        var coef = TRACK.getTrackLength() / TRACK.getTrackLengthInWGS84();
        setInterval(function(e) {
            var ctime = (new Date()).getTime();
            var elapsed = ((ctime - stime)/1000.0)/trackInSeconds;
            var pos = TRACK.__getPositionAndRotationFromElapsed(elapsed % 1.0);
            var dist1 = (Math.random()*2.0-1.0) * randcoef;
            var dist2 =  (Math.random()*2.0-1.0)  * randcoef;
            var alt = 1000*Math.random();
            var overallRank = parseInt(20*Math.random())+1;
            var groupRank = parseInt(20*Math.random())+1;
            var genderRank = parseInt(20*Math.random())+1;
            //pos[0]+=dist1;
            //pos[1]+=dist2;
            part.ping(pos,80+Math.random()*10,false,ctime,alt,overallRank,groupRank,genderRank,elapsed);
        }, CONFIG.simulation.pingInterval*1000);
    };
};

module.exports = new DemoSimulation();


