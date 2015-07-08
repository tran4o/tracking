Class("Track", 
{	
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
        route : {
            is:   "rw"
        },
        distances : {
            is:   "rw"
        },
        distancesElapsed : {
            is:   "rw"
        },
		totalLength : {
			is : "rw"
		},
		participants : {
			is:   "rw",
			init : []
		},
		movingCams : {
			is:   "rw",
			init : []
		},
		// in EPSG 3857
		feature : {
			is : "rw",
			init : null
		},
		isDirectionConstraint : {
			is : "rw",
			init : false
		},
		
		debugParticipant : {
			is : "rw",
			init : null
		},
		bikeStartKM : {
			is : "rw",
			init : null
		},
		runStartKM : {
			is : "rw",
			init : null
		},
		laps : {
			is : "ro",
			init : 1
		},
		totalParticipants : {
			is : "ro",
			init : 50
		},
		rTree : {
			is : "ro",
			init : rbush(10)
		}
    },
    //--------------------------------------
	methods: 
	{
		generateFromLocations : function(addresses,onSuccessCallback,onErrorCallback,isForceLookup) 
		{
			if (!isForceLookup) {
				var ok=true;
				var pp=[];
				for (var i=0;i<addresses.length;i++)
				{
					var adr = addresses[i];
					if (adr instanceof Array && adr.length == 2 && parseFloat(adr[0]) === adr[0] && parseFloat(adr[1]) === adr[1]) {
						pp.push([adr[0],adr[1]]);
						continue;
					}
					var tt = adr.split(" ");
					if (tt.length != 2) {
						ok=false;
						break;
					}
					tt[0]=myTrimCoordinate(tt[0]);
					tt[1]=myTrimCoordinate(tt[1]);				
					if (isNaN(parseFloat(tt[0])) || isNaN(parseFloat(tt[1])))
					{
						ok=false;
						break;
					}
					pp.push([parseFloat(tt[1]),parseFloat(tt[0])]);
				}
				if (ok) {
					this.setRoute(pp);
					if (onSuccessCallback) 
						onSuccessCallback();
					return;
				}
			} else {
				var pp=[];
				for (var i=0;i<addresses.length;i++)
				{
					var adr = addresses[i];
					if (adr instanceof Array && adr.length == 2 && parseFloat(adr[0]) === adr[0] && parseFloat(adr[1]) === adr[1]) {
						pp.push(adr[1]+", "+adr[0]);
					} else {
						pp.push(adr);
					}
				}
				addresses=pp;
			}
			//http://dev.virtualearth.net/REST/V1/Routes/Walking?wp.0=Plovdiv&wp.1=Sofia&optmz=distance&routeAttributes=routePath&key=Aijt3AsWOME3hPEE_HqRlUKdcBKqe8dGRZH_v-L3H_FF64svXMbkr1T6u_WASoet
			// Addresses > array of STRING (exact location on map)	
			var wps=[];
			
			for (var i=0;i<addresses.length;i++) {
				var adr = addresses[i];
				wps.push("wp."+wps.length+"="+encodeURIComponent(adr));
			}
			var url = "http://dev.virtualearth.net/REST/V1/Routes/Walking?"+wps.join("&")+"&optmz=distance&routeAttributes=routePath&key="+GUI.bingMapKey;

			var tt = localStorage.getItem("BING_"+encodeURIComponent(url));
			if (tt) {
				this.setRoute(JSON.parse(tt));
				onSuccessCallback();
				return;
			}
			//------------------------------------------------------------------
			var that=this;
			$.getJSON(url+'&jsonp=?', function(result) 
			{
				if (result.statusCode != 200) {
					var msg="Unknown error";
					if (result.errorDetails) 
						msg=result.errorDetails.join("\n");
					onErrorCallback(msg);
				} else {

					if (
						result.resourceSets && result.resourceSets.length && 
						result.resourceSets[0].resources && result.resourceSets[0].resources.length && 
						result.resourceSets[0].resources[0] && result.resourceSets[0].resources[0].routePath && 
						result.resourceSets[0].resources[0].routePath.line && result.resourceSets[0].resources[0].routePath.line.coordinates && 
						result.resourceSets[0].resources[0].routePath.line.coordinates.length >= 2 
						) 
					{
						var path = result.resourceSets[0].resources[0] && result.resourceSets[0].resources[0].routePath.line.coordinates;
						var route = [];
						for (var i=0;i<path.length;i++) {
							var e = path[i]; 
							route.push([e[1],e[0]]); //ol.proj.transform([e[1],e[0]], 'EPSG:4326', 'EPSG:3857'));
						}
						localStorage.setItem("BING_"+encodeURIComponent(url),JSON.stringify(route));
						that.setRoute(route);
						onSuccessCallback();
					} else {
						onErrorCallback("Response JSON has wrong format!");
					}
				}
            });
		},
		
		setRoute : function(val) {
			this.route=val;
			delete this._lentmp1;
			delete this._lentmp2;
		},
		
		getBoundingBox : function() {
			var minx=null,miny=null,maxx=null,maxy=null;
			for (var i=0;i<this.route.length;i++)
			{
				var p=this.route[i];
				if (minx == null || p[0] < minx) minx=p[0];
				if (maxx == null || p[0] > maxx) maxx=p[0];
				if (miny == null || p[1] < miny) miny=p[1];
				if (maxy == null || p[1] > maxy) maxy=p[1];
			}
			return [minx,miny,maxx,maxy];
		},
		
		// return [0..1]		
		getElapsedFromPoint : function(point,start) 
		{
			var res=0.0;
			var brk=false;
			var cc = this.route;
			if (!start)
				start=0;
			for (var i=start;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var c = cc[i+1];
				var b = point;
				var ac = Math.sqrt((a[0]-c[0])*(a[0]-c[0])+(a[1]-c[1])*(a[1]-c[1]));
				var ba = Math.sqrt((b[0]-a[0])*(b[0]-a[0])+(b[1]-a[1])*(b[1]-a[1]));
				var bc = Math.sqrt((b[0]-c[0])*(b[0]-c[0])+(b[1]-c[1])*(b[1]-c[1]));
				
				var minx = a[0] < b[0] ? a[0] : b[0];
				var miny = a[1] < b[1] ? a[1] : b[1];
				var maxx = a[0] > b[0] ? a[0] : b[0];
				var maxy = a[1] > b[1] ? a[1] : b[1];
				// ba > ac OR bc > ac
				if (b[0] < minx || b[0] > maxx || b[1] < miny || b[1] > maxy || ba > ac || bc > ac) 
				{
					res+=WGS84SPHERE.haversineDistance(a,c);
					continue;
				}
				res+=WGS84SPHERE.haversineDistance(a,b);
				break;
			}
			var len = this.getTrackLength();
			return res/len;
		},
		
		// elapsed from 0..1
		getPositionFromElapsed : function(elapsed) {
			elapsed*=this.getTrackLength();
			var rr=null;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var c = cc[i+1];
				var ac = WGS84SPHERE.haversineDistance(a,c);
				if (elapsed <= ac) {
					rr=[ a[0]+(c[0]-a[0])*elapsed/ac,a[1]+(c[1]-a[1])*elapsed/ac ];
					break;
				}
				elapsed-=ac;
			}
			return rr;
		},

		getRotationFromElapsed : function(elapsed) 
		{
			elapsed*=this.getTrackLength();
			var rotation=null;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var c = cc[i+1];
				var ac = WGS84SPHERE.haversineDistance(a,c);
				if (elapsed <= ac) 
				{
					var dx = c[0] - a[0];
					var dy = c[1] - a[1];
					rotation=Math.atan2(dy, dx);
					break;
				}
				elapsed-=ac;
			}
			return rotation;
		},
		
		getTrackLength : function() {
			if (this._lentmp1)
				return this._lentmp1;
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = WGS84SPHERE.haversineDistance(a,b);
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this._lentmp1=res;
			return res;
		},

		getTrackLengthInWGS84 : function() {
			if (this._lentmp2)
				return this._lentmp2;
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = Math.sqrt((a[0]-b[0])*(a[0]-b[0])+(a[1]-b[1])*(a[1]-b[1]));
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this._lentmp2=res;
			return res;
		},

		getCenter : function() {
			var bb = this.getBoundingBox();
			return [(bb[0]+bb[2])/2.0,(bb[1]+bb[3])/2.0];
		},
		
		init : function() 
		{
			if (!this.route)
				return;
			// 1) calculate total route length in KM 
			this.updateFeature();
			if (typeof window != "undefined")
				GUI.map.getView().fitExtent(this.feature.getGeometry().getExtent(), GUI.map.getSize());
		},
		
		getTrackPart : function(elapsed) {
			var len = this.getTrackLength();
			var em = (elapsed%1.0)*len;
			if (em >= this.runStartKM*1000) 
				return 2;
			if (em >= this.bikeStartKM*1000) 
				return 1;
			return 0;
		},
		
		updateFeature : function() 
		{
			this.distances=[];
			var res=0.0;
			var cc = this.route;
			for (var i=0;i<cc.length-1;i++) 
			{
				var a = cc[i];
				var b = cc[i+1];
				var d = WGS84SPHERE.haversineDistance(a,b);
				this.distances.push(res);
				if (!isNaN(d) && d > 0) 
					res+=d;
			}
			this.distances.push(res);
			this.distancesElapsed=[];
			var tl = this.getTrackLength();
			for (var i=0;i<cc.length;i++) {
				this.distancesElapsed.push(this.distances[i]/tl);
			}
			//--------------------------------------------------------------
			this.rTree.clear();
			var arr = [];
			for (var i=0;i<this.route.length-1;i++)
			{
				var x1 = this.route[i][0];
				var y1 = this.route[i][1];
				var x2 = this.route[i+1][0];
				var y2 = this.route[i+1][1];
				var minx = x1 < x2 ? x1 : x2;
				var miny = y1 < y2 ? y1 : y2;
				var maxx = x1 > x2 ? x1 : x2;
				var maxy = y1 > y2 ? y1 : y2;
				arr.push([minx,miny,maxx,maxy,{ index : i }]);
			}
			this.rTree.load(arr);
			//----------------- ---------------------------------------------
			if (typeof window != "undefined")
			{
				var wkt = [];
				for (var i=0;i<this.route.length;i++) {
					wkt.push(this.route[i][0]+" "+this.route[i][1]);
				}
				wkt="LINESTRING("+wkt.join(",")+")";
				var format = new ol.format.WKT();
				if (!this.feature) {
					this.feature = format.readFeature(wkt);
				} else {
					this.feature.setGeometry(format.readFeature(wkt).getGeometry());
				}
				this.feature.track=this;
				this.feature.getGeometry().transform('EPSG:4326', 'EPSG:3857');
			}
		},
		
		newParticipant : function(id,deviceId,name)
		{
			var part = new Participant({id:id,deviceId:deviceId,code:name});
			part.init(this.route[0]);
			part.setSeqId(this.participants.length);
			this.participants.push(part);
			return part;
		},

		newMovingCam : function(id,deviceId,name)
		{
			var cam = new MovingCam({id:id,deviceId:deviceId,code:name});
			cam.init(this.route[0]);
			cam.setSeqId(this.movingCams.length);
			this.movingCams.push(cam);
			return cam;
		},
		
		onMapClick : function(event) 
		{
			if (this.debugParticipant) 
			{
				this.debugParticipant.onDebugClick(event);
			}
		}

    }
});