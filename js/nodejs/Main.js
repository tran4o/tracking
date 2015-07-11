var express = require('express');
var compress = require('compression');
var extend = require('util')._extend;
var bodyParser = require('body-parser');
//--------------------------------------------------------------------
var Utils = require('./../app/Utils');
var Config = require('./Config');
var Tracking = require('./Tracking');
var fs = require('fs');
var path = require('path');

//--------------------------------------------------------------------
var app = express();
app.use('/admin', express.static(__dirname + '/admin'));
app.use('/data/img', express.static(__dirname + './../../data/img'));
app.use(compress());
app.use(bodyParser.json({ limit: '5mb' }));       
app.use(bodyParser.urlencoded({     
  extended: true
})); 
app.get('/raceStart/:id', function (req, res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	var id = req.params.id;
	var part = Tracking.partLookupByIMEI[id];
	if (!part) {
		res.send(JSON.stringify({RET:"ERR",RETMSG:"PARTICIPANT BY IMEI NOT FOUND"}));
	} else {
		var now = (new Date()).getTime();
		var startperiod = parseInt((part.startTime-now)/(1000.0*60));		// seconds
		if (startperiod < 0)
			startperiod=0;
		var endperiod = 9999999;									    // seconds
		res.send(JSON.stringify({"RET":"OK","RETMSG":"","TYPE":"RACESTART","VER":"1.0","IMEI":id,"STARTPERIOD":""+startperiod,"ENDPERIOD":""+endperiod}));
	}
});

app.get('/status', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	var now = (new Date()).getTime();
	var moretogo = (Config.event.startTime.getTime()-now);
	if (moretogo < 0) {
		moretogo=0;
	}	
	var partStatus = {};
	for (var i in Tracking.trackedParticipants)
	{
		var part = Tracking.trackedParticipants[i];
		var pos = part.getGPS();
		var ltmp = part.getLastPingTimestamp();
		partStatus[part.id]=
		{
			imei : part.deviceId,
			lon : pos[0],
			lat : pos[1],
			realDelay : part.lastRealDelay,
			lostDelay : part.signalLostDelay,
			lastReq : ltmp ? Utils.formatTimeSec(new Date(ltmp)) : "-",
			elapsed : part.getElapsed()*100.0
		};
	}
	res.send(JSON.stringify({
		startStr : Utils.formatTimeSec(Config.event.startTime),
		startAfter : moretogo,
		partStatus : partStatus
	},null,4));
});

app.get('/assignment/:id', function (req, res) 
{
	console.log("GET assignment for id = "+req.params.id);
	res.header("Content-Type", "application/json; charset=utf-8");
	var id = req.params.id;
	var imei = Config.mapIMEI(req.params.imei);
	res.send(JSON.stringify({id:id,imei:imei}));
});

app.get('/aliases', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	res.send(JSON.stringify(Config.aliases, null, 4));
});

app.get('/assignments', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	var r={};
	for (var i in Config.assignments) 
		r[i]=Config.mapIMEI(Config.assignments[i]);
	res.send(JSON.stringify(r, null, 4));
});

app.post('/participant/:id/setimei', function (req, res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	var id = req.params.id;
	var imei = Config.mapIMEI(req.body.value);
	var img = req.body.img;
	//console.log("SET participant IMEI for ID="+id+" VALUE="+imei+" IMG="+img);
	if (imei && imei.length) 
	{
		var torem=[];
		for (var i in Config.assignments) if (i != id)
		{
			var val = Config.assignments[i];
			if (val == imei) 
			{
				// ERROR allready found
				var ok=false;
				for (var j in Config.participants) 
				{	
					var part = Config.participants[j];
					if (part.idParticipant == i) {
						ok=part;
						break;
					} 
				}
				if (ok) {
					res.send(JSON.stringify({error : "IMEI allready used by participant "+ok.idParticipant},null,4));
					return;
				}
				torem.push(i);
			}
		}
		for (var i in torem) 
			Config.assignIMEI(torem[i],null);			
		Config.assignIMEI(id,imei);
	} else {
		Config.assignIMEI(id,null);
	}	
	res.send(JSON.stringify({imei:imei}));
	//-------------------------------------
	// WRITE IMAGE 
	if (img && img.length) {		
		var ipath = path.join(__dirname, "../../data/img/"+id+".jpg");
		fs.writeFileSync(ipath, Utils.decodeBase64Image(img).data); 
	}
});


app.get('/participant/:id', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	var id = req.params.id;
	for (var i in Config.participants) 
	{	
		var part = Config.participants[i];
		if (part.idParticipant == id) 
		{
			var pp = extend({}, part);
			var apath = path.join(__dirname, "../../data/img/"+id+".jpg");
			console.log(apath);
			
			var data = "{}";
			if (!fs.existsSync(apath))
				apath="placeholder-128x128.png";
			else
				apath="../../data/img/"+id+".jpg";
			pp.img=apath;
			console.log(pp);

			if (Config.assignments[id])
				pp.IMEI=Config.unmapIMEI(Config.assignments[id]);
			res.send(JSON.stringify(pp, null, 4));
			return;
		}
	}
	res.send(JSON.stringify({}));
});

app.get('/participants', function (req, res) 
{
	//console.log(req.query);
	res.header("Content-Type", "application/json; charset=utf-8");
	if (req.query.mode == "acmpl") 
	{
		var r = [];
		for (var i in Config.participants) {
			var part = Config.participants[i];
			var name = Utils.myTrim(part.firstname+" "+part.lastname);
			var data = part.idParticipant;
			r.push({value:name,data:data});
		}
		res.send(JSON.stringify(r, null, 4));
	} else {
		res.send(JSON.stringify(Config.participants, null, 4));
	}
});

app.get('/event', function (req, res) {
	//res.header("Content-Type", "application/json; charset=utf-8");
	res.send('Hello World!');
});
//--------------------------------------------------------------------
var server = app.listen(3000, function () 
{
  var host = server.address().address;
  var port = server.address().port;
  console.log("\n---------------------------------------------");
  console.log('Example app listening at http://%s:%s', host, port);
});

