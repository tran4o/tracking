var express = require('express');
var compress = require('compression');
var extend = require('util')._extend;
var bodyParser = require('body-parser');
var moment = require('moment');
//--------------------------------------------------------------------
var Utils = require('./../app/Utils');
var Config = require('./Config');
var Tracking = require('./Tracking');
var fs = require('fs');
var path = require('path');

//--------------------------------------------------------------------
function getRaceStartPeriod(part) {
	var now = (new Date()).getTime();
	var startperiod = Math.floor((part.startTime-now)/1000.0);		// seconds
	if (startperiod < 0)
		startperiod=0;
	return startperiod;
}
//--------------------------------------------------------------------
var app = express();

// allow CORS requests - useful  when  locally developing with Apache server and etc. - still disable it for production
//app.use(function(req, res, next) {
//	res.header("Access-Control-Allow-Origin", "*");
//	res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
//	res.header('Access-Control-Allow-Methods', 'GET,PUT,POST');
//	next();
//});

app.use('/test/admin', express.static(__dirname + '/admin'));
app.use('/test', express.static(__dirname + './../../'));
app.use('/legacy', express.static(__dirname + './../../legacy'));
app.use('/admin', express.static(__dirname + '/admin'));
app.use('/data/img', express.static(__dirname + './../../data/img'));
app.use(compress());
app.use(bodyParser.urlencoded({     
  extended: true,
  limit: '50mb'
})); 
app.use(bodyParser.json({limit: '50mb'}));
app.get('/raceStart/:id', function (req, res) {
	var event = Config.getCurrentOrNextEvent();
	if (event == null)
		return;
	res.header("Content-Type", "application/json; charset=utf-8");
	if (Config.simulation.debugStarts) {
		res.send(JSON.stringify({"RET":"OK","RETMSG":"","TYPE":"RACESTART","VER":"1.0","IMEI":id,"STARTPERIOD":"0","ENDPERIOD":"0"}));
		return;
	}
	var id = req.params.id;
	var part = event.partLookupByIMEI[id];
	if (!part) {
		res.send(JSON.stringify({RET:"ERR",RETMSG:"PARTICIPANT BY IMEI NOT FOUND"}));
	} else {
		var startperiod=getRaceStartPeriod(part);
		var endperiod = 9999999;									    // seconds
		res.send(JSON.stringify({"RET":"OK","RETMSG":"","TYPE":"RACESTART","VER":"1.0","IMEI":id,"STARTPERIOD":""+Math.floor(startperiod/1000),"ENDPERIOD":""+endperiod}));
	}
});

app.get('/status', function (req, res) 
{	
	res.header("Content-Type", "application/json; charset=utf-8");
	var event = Config.getCurrentOrNextEvent();
	if (event == null)
		return;
	var now = (new Date()).getTime();
	var moretogo = (event.startTime.getTime()-now);
	if (moretogo < 0) {
		moretogo=0;
	}	
	var partStatus = {};
	for (var i in event.trackedParticipants)
	{
		var part = event.trackedParticipants[i];
		var pos = part.getGPS();
		var ltmp = part.getLastPingTimestamp();
		var startperiod=getRaceStartPeriod(part);
		
		partStatus[part.id]=
		{
			name : part.getCode(),
			imei : part.deviceId,
			lon : pos[0],
			lat : pos[1],
			realDelay : part.lastRealDelay,
			lostDelay : part.signalLostDelay,
			lastReq : ltmp ? Utils.formatTimeSec(new Date(ltmp)) : "-",
			elapsed : part.getElapsed()*100.0,
			start : startperiod
		};
	}
	res.send(JSON.stringify({
		startStr : Utils.formatTimeSec(event.startTime),
		startAfter : moretogo,
		partStatus : partStatus
	},null,4));
});

app.get('/aliases', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	res.send(JSON.stringify(Config.aliases, null, 4));
});


app.get('/assignments/:eid', function (req, res) 
{
	var event = Config.getEventById(req.params.eid);
	res.header("Content-Type", "application/json; charset=utf-8");
	var r={};
	for (var i in event.assignments) 
		r[i]=Config.mapIMEI(event.assignments[i]);
	res.send(JSON.stringify(r, null, 4));
});

app.post('/participant/:eid/:id/setimei', function (req, res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	var event = Config.getEventById(req.params.eid);
	var id = req.params.id;
	var imei = Config.mapIMEI(req.body.value);
	var img = req.body.img;
	//console.log("SET participant IMEI for ID="+id+" VALUE="+imei+" IMG="+img);
	if (imei && imei.length) 
	{
		var torem=[];
		for (var i in event.assignments) if (i != id)
		{
			var val = event.assignments[i];
			if (val == imei) 
			{
				// ERROR allready found
				var ok=false;
				for (var j in event.participants) 
				{	
					var part = event.participants[j];
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
			Config.assignIMEI(event,torem[i],null);			
		Config.assignIMEI(event,id,imei);
	} else {
		Config.assignIMEI(event,id,null);
	}	
	res.send(JSON.stringify({imei:imei}));
	//-------------------------------------
	// WRITE IMAGE 
	if (img && img.length) {		
		var ipath = path.join(__dirname, "../../data/img/"+id+".jpg");
		fs.writeFileSync(ipath, Utils.decodeBase64Image(img).data); 
	}
});


app.get('/participant/:eid/:id', function (req, res) 
{
	res.header("Content-Type", "application/json; charset=utf-8");
	var event = Config.getEventById(req.params.eid);
	var id = req.params.id;
	for (var i in event.participants) 
	{	
		var part = event.participants[i];
		if (part.idParticipant == id) 
		{
			var pp = extend({}, part);
			var apath = path.join(__dirname, "../../data/img/"+id+".jpg");
			var data = "{}";
			if (!fs.existsSync(apath))
				apath="placeholder-128x128.png";
			else
				apath="../../data/img/"+id+".jpg";
			pp.img=apath;
			if (event.assignments[id])
				pp.IMEI=Config.unmapIMEI(event.assignments[id]);
			res.send(JSON.stringify(pp, null, 4));
			return;
		}
	}
	res.send(JSON.stringify({}));
});


function partDataTablesJSON(part) {
	function DEF(val,def) {
		if (val == null || val === undefined)
			return def;
		return val;
	}
	return ({
		id:DEF(part.idParticipant,"0"),
		firstname:DEF(part.firstname,""),
		lastname:DEF(part.lastname,""),
		birthDate: part.birthDate && part.birthDate > 0 ? Utils.formatDate(new Date(part.birthDate)) : "",
		nationality:DEF(part.nationality,""),
		club:DEF(part.club,""),
		gender:DEF(part.sex,""),
		startGroup:DEF(part.startGroup,""),
		startNo : ""+(isNaN(parseInt(part.startNo)) ? 0 : parseInt(part.startNo))  
	  });
}

function startDataTablesJSON(start) {
	function DEF(val,def) {
		if (val == null || val === undefined)
			return def;
		return val;
	}
	return ({
		id:DEF(start.id,"0"),
		fromStartNo:DEF(start.fromStartNo,"0"),
		toStartNo:DEF(start.toStartNo,"0"),
		startTime:start.startTime ? moment(start.startTime).format("HH:mm") : "00:00"
	  });
}


function eventDataTablesJSON(event) {
	function DEF(val,def) {
		if (val == null || val === undefined)
			return def;
		return val;
	}
	return ({
		id:DEF(event.id,"0"),
		code:DEF(event.code,""),
		startTime:event.startTime ? moment(event.startTime).format("DD.MM.YYYY HH:mm") : "01.01.2015 00:00",
		endTime:event.endTime ? moment(event.endTime).format("DD.MM.YYYY HH:mm") : "01.01.2015 00:00",
		track:event.trackData ? JSON.stringify(event.trackData) : "[]",
		runStartKM:DEF(event.runStartKM,"0"),
		bikeStartKM:DEF(event.bikeStartKM,"0")
	  });
}


function updateEvent(req,res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	function doIt(event) 
	{
		if (!moment(event.startTime, "DD.MM.YYYY HH:mm").isValid()) {
			res.send(JSON.stringify({error:"Start not valid!"}, null, 4));
			return;
		}
		if (!moment(event.endTime, "DD.MM.YYYY HH:mm").isValid()) {
			res.send(JSON.stringify({error:"End not valid!"}, null, 4));
			return;
		}
		event.startTime=moment(event.startTime, "DD.MM.YYYY HH:mm").toDate();
		event.endTime=moment(event.endTime, "DD.MM.YYYY HH:mm").toDate();
		event.bikeStartKM=parseFloat(event.bikeStartKM);
		if (isNaN(event.bikeStartKM)) {
			res.send(JSON.stringify({error:"Bike start not valid!"}, null, 4));
			return;
		}
		event.runStartKM=parseFloat(event.runStartKM);
		if (isNaN(event.runStartKM)) {
			res.send(JSON.stringify({error:"Run start not valid!"}, null, 4));
			return;
		}
		if (!event.code)
			event.code="";
		if (event.track || event.track != "") 
		{
			var ok = false;
			try {
				event.track=JSON.parse(event.track);
				ok=true;
			} catch(e) {}
			if (!ok) {
				res.send(JSON.stringify({error:"Track not valid!"}, null, 4));
				return;
			}
		} else {
			event.track=[];
		}
		var r = Config.updateEvent(event.id,event);
		if (typeof r == "string") {
			res.send(JSON.stringify({error:r}, null, 4));
			return;
		}
		res.send(JSON.stringify({data:[eventDataTablesJSON(r)]}, null, 4));
		return;
	}
	if (req.body.action == "remove") 
	{
		for (var id in req.body.data) 
		{
			if (!Config.deleteEvent(id)) {
				res.send(JSON.stringify({error:"Event not found!"}, null, 4));
				return;
			}
			res.send(JSON.stringify({}), null, 4);
			return;
		}
	} else if (req.body.action == "create") {
		for (var id in req.body.data) 
		{
			var event = req.body.data[id];
			function guid() 
			{
				  function s4() {
				    return Math.floor((1 + Math.random()) * 0x10000)
				      .toString(16)
				      .substring(1).toUpperCase();
				  }
				  return s4() + s4(); 
			}
			event.id=guid();
			doIt(event);
		}
	} else if (req.body.action == "edit") {
		for (var id in req.body.data) 
		{
			var event = req.body.data[id];
			doIt(event);
		}
	} else {
		console.log("UNKNOWN ACTION "+req.body.action);
	}
}

function updateStart(req,res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	var eventId = req.params.id;
	for (var j in Config.events) 
	{
		var event = Config.events[j];
		if (event.id == eventId) 
		{
			function doIt(start) 
			{
				if (!moment(start.startTime, "HH:mm").isValid()) {
					res.send(JSON.stringify({error:"Start time not valid!"}, null, 4));
					return;
				}
				start.startTime=moment(start.startTime, "HH:mm").toDate();
				start.fromStartNo=parseInt(start.fromStartNo);
				start.toStartNo=parseInt(start.toStartNo);
				if (isNaN(start.fromStartNo)) {
					res.send(JSON.stringify({error:"From start not valid!"}, null, 4));
					return;
				}
				if (isNaN(start.toStartNo)) {
					res.send(JSON.stringify({error:"To start not valid!"}, null, 4));
					return;
				}
				var r = Config.updateStart(event,start.id,start);
				if (typeof r == "string") {
					res.send(JSON.stringify({error:r}, null, 4));
					return;
				}
				res.send(JSON.stringify({data:[startDataTablesJSON(r)]}, null, 4));
				return;
			}
			if (req.body.action == "remove") 
			{
				for (var id in req.body.data) 
				{
					if (!Config.deleteStart(event,id)) {
						res.send(JSON.stringify({error:"Start not found!"}, null, 4));
						return;
					}
					res.send(JSON.stringify({}), null, 4);
					return;
				}
			} else if (req.body.action == "create") {
				for (var id in req.body.data) 
				{
					var start = req.body.data[id];
					function guid() 
					{
						  function s4() {
						    return Math.floor((1 + Math.random()) * 0x10000)
						      .toString(16)
						      .substring(1).toUpperCase();
						  }
						  return s4() + s4(); 
					}
					start.id=guid();
					doIt(start);
				}
			} else if (req.body.action == "edit") {
				for (var id in req.body.data) 
				{
					var start = req.body.data[id];
					doIt(start);
				}
			} else {
				console.log("UNKNOWN ACTION "+req.body.action);
			}
		}
	}
}


function updatePart(req,res) {
	var event = Config.getEventById(req.params.eid);
	res.header("Content-Type", "application/json; charset=utf-8");
	function doIt(part) 
	{
		if (part.birthDate && part.birthDate != "") {
			part.birthDate=moment(part.birthDate, "DD.MM.YYYY");
			if (part.birthDate.isValid()) {
				part.birthDate=part.birthDate.toDate().getTime();
			} else {
				res.send(JSON.stringify({error:"Birth date not valid!"}, null, 4));
				return;
			}
		} else 
			delete part.birthDate;
		part.startNo=parseInt(part.startNo);
		if (isNaN(part.startNo) || part.startNo < 0) {
			res.send(JSON.stringify({error:"Start No not valid!"}, null, 4));
			return;
		}
		var r = Config.updateParticipant(event,part.id,part);
		if (typeof r == "string") {
			res.send(JSON.stringify({error:r}, null, 4));
			return;
		}
		//res.send(JSON.stringify({data:[part]}, null, 4));
		res.send(JSON.stringify({data:[partDataTablesJSON(r)]}, null, 4));
		return;
	}
	if (req.body.action == "remove") 
	{
		for (var id in req.body.data) 
		{
			if (!Config.deleteParticipant(id)) {
				res.send(JSON.stringify({error:"Participant not found!"}, null, 4));
				return;
			}
			res.send(JSON.stringify({}), null, 4);
			return;
		}
	} else if (req.body.action == "create") {
		for (var id in req.body.data) 
		{
			var part = req.body.data[id];
			function guid() 
			{
				  function s4() {
				    return Math.floor((1 + Math.random()) * 0x10000)
				      .toString(16)
				      .substring(1).toUpperCase();
				  }
				  return s4() + s4() + s4() + s4() + s4() + s4(); 
			}
			part.id=guid();
			doIt(part);
		}
	} else if (req.body.action == "edit") {
		for (var id in req.body.data) 
		{
			var part = req.body.data[id];
			doIt(part);
		}
	} else {
		console.log("UNKNOWN ACTION "+req.body.action);
	}
}
app.put('/events', updateEvent);
app.post('/events', updateEvent);
app.get('/events', function (req, res) 
{
	//console.log(req.query);
	var eventId = req.params.id;
	res.header("Content-Type", "application/json; charset=utf-8");
	var t=[];
	for (var j in Config.events) 
		t.push(Config.events[j]);
	t.sort(function(a, b){
		var at = a.startTime.getTime();
		var bt = b.startTime.getTime();
		return -(at-bt);
	});
	var r=[];
	for (var j in t) 
	{
		var event = t[j];
		r.push(eventDataTablesJSON(event));
	}
	res.send(JSON.stringify({data : r}, null, 4));
});

app.put('/starts/:id', updateStart);
app.post('/starts/:id', updateStart);
app.get('/starts/:id', function (req, res) 
{
	//console.log(req.query);
	var eventId = req.params.id;
	res.header("Content-Type", "application/json; charset=utf-8");
	for (var j in Config.events) 
	{
		var event = Config.events[j];
		if (event.id == eventId) 
		{
			var r = [];
			for (var i in event.starts) 
			{
				var start = event.starts[i];
				r.push(startDataTablesJSON(start));
			}
			res.send(JSON.stringify({data : r}, null, 4));
			break;
		}
	}
});
app.put('/participants/:eid', updatePart);
app.post('/participants/:eid', updatePart);
app.get('/participants/:eid', function (req, res) 
{
	var event = Config.getEventById(req.params.eid);
	res.header("Content-Type", "application/json; charset=utf-8");
	if (req.query.mode == "acmpl") 
	{
		var r = [];
		for (var i in event.participants) {
			var part = event.participants[i];
			var name = Utils.myTrim(part.firstname+" "+part.lastname);
			var data = part.idParticipant;
			r.push({value:name,data:data});
		}
		res.send(JSON.stringify(r, null, 4));
	} else if (req.query.mode == "bcmpl") {
		var r = [];
		for (var i in event.participants) {
			var part = event.participants[i];
			var data = part.idParticipant;
			r.push({value:""+p.startPos(),data:data});
		}
		res.send(JSON.stringify(r, null, 4));
	} else if (req.query.mode == "dtbl") {
		var r = [];
		for (var i in event.participants) 
		{
			var part = event.participants[i];
			r.push(partDataTablesJSON(part));
		}
		res.send(JSON.stringify({data : r}, null, 4));
	} else {
		res.send(JSON.stringify(event.participants, null, 4));
	}
});

app.get('/event', function (req, res) {
	res.header("Content-Type", "application/json; charset=utf-8");
	res.header("Access-Control-Allow-Origin", "http://localhost");	
	var event=null;
	if (req.query.event) 
	{
		for (var i in Config.events) 
		{
			var e = Config.events[i];
			if (e.code == req.query.event || e.id == req.query.event) 
			{
				event=e;
				break;
			}
		}
	}
	if (!event) {
		res.send(JSON.stringify({}, null, 4));
		return;
	}
	res.header("Content-Type", "application/json; charset=utf-8");
	res.header("Access-Control-Allow-Origin", "http://localhost");
	Tracking.prepareEvent(event);
	var parr=[];
	var cams=[];
	for (var i in event.trackedParticipants) 
	{
		var part = event.trackedParticipants[i];
		var rres={
			id : part.id,
			code : part.code,
			color : part.color,
			ageGroup : part.ageGroup,
			age : part.age,
			country : part.country,
			startPos : part.startPos,
			gender : part.gender,
			icon : part.icon,
			image : part.image,
			deviceId : part.deviceId
		};
		if (part.__cam)
			cams.push(rres);
		else
			parr.push(rres);
	}
	var ss=[];
	for (var i in event.starts) {
		var s = event.starts[i];
		ss.push({id:s.id,start:s.startTime.getTime(),fromStartNo:s.fromStartNo,toStartNo:s.toStartNo,code:s.fromStartNo+" - "+s.toStartNo});
	}
	var rres = 
	{
		times: 
		{
			startTime : event.startTime.getTime(),
			endTime : event.endTime.getTime()
		},
		bikeStartKM : event.bikeStartKM,
		runStartKM : event.runStartKM,
		participants : parr,
		cams : cams,
		route : event.trackData,
		starts : ss
	};
	res.send(JSON.stringify(rres, null, 4));
});

app.post('/stream', function (req, _res) 
{
	_res.header("Content-Type", "application/json; charset=utf-8");
	var res=[];
	var tdone=0;
	var tlen = req.body.length;
	function onDone(tres) {
		for (var i=0;i<tres.length;i++)
			res.push(tres[i]);
		tdone++;
		if (tdone == tlen) {
			_res.send(JSON.stringify(res, null, 4));
		}
	}
	for (var i in req.body) 
	{
		var e = req.body[i];
		Tracking.queryData(e.imei,e.start,e.end,onDone); 
	}	
});
//--------------------------------------------------------------------
var server = app.listen(3000, function () 
{
  var host = server.address().address;
  var port = server.address().port;
  console.log("\n---------------------------------------------");
  console.log('Example app listening at http://%s:%s', host, port);
});

