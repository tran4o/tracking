Class("GUI", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has: 
	{
    	isDebug : {
    		is : "rw",
    		init : !MOBILE
    	},
		receiverOnMapClick : {
			is : "rw",
			init : []
		},
        width : {
            is:   "rw",
            init: 750
        },
        height: {
            is:   "rw",
            init: 500
        },
		track : {
			is:   "rw"
		},
		elementId : {
			is : "rw",
			init : "map"
		},
		initialPos : {	
			is : "rw",
			init : null
		},
		initialZoom : {	
			is : "rw",
			init : 10
		},
		bingMapKey : {
			is : "rw",
			init : 'Aijt3AsWOME3hPEE_HqRlUKdcBKqe8dGRZH_v-L3H_FF64svXMbkr1T6u_WASoet'
		},
		//-------------------
		map : {
			is : "rw",
			init : null
		},
		trackLayer : {
			is : "rw",
			init : null
		},
		participantsLayer : {
			is : "rw",
			init : null
		},
		debugLayerGPS : {
			is : "rw",
			init : null
		},	
		selectedParticipant : {
			is : "rw",
			init : null
		},
		popup : {
			is : "rw",
			init : null
		},
		isShowSwim : {
			is : "rw",
			init : true
		},
		isShowBike : {
			is : "rw",
			init : true
		},
		isShowRun : {
			is : "rw",
			init : true
		}
    },
    //--------------------------------------
	methods: 
	{
        init: function (params)  
		{
			var defPos = [0,0];
			if (this.initialPos) 
				defPos=this.initialPos;
			//---------------------------------------------
			var extent = params && params.skipExtent ? null : TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
			this.trackLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["track"]
			});
			this.participantsLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["participant"]
			});
			if (this.isDebug)
			this.debugLayerGPS = new ol.layer.Vector({
				  source: new ol.source.Vector(),
				  style : STYLES["debugGPS"]
			});
			//--------------------------------------------------------------
			var ints = [];
			this.popup = new ol.Overlay.Popup({ani:false,panMapIfOutOfView : false});
			this.map = new ol.Map({
			  renderer : "canvas",
			  target: 'map',
			  layers: [
				new ol.layer.Tile({
				  source: new ol.source.BingMaps({
					key: this.bingMapKey,
					imagerySet: 'Road'
					//imagerySet: 'AerialWithLabels'
					
				  })
				}),
				this.trackLayer,this.participantsLayer
			  ],
			  view: new ol.View({
				center: ol.proj.transform(defPos, 'EPSG:4326', 'EPSG:3857'),
				zoom: this.getInitialZoom(),
				minZoom: 0,
				maxZoom: 19,
				extent : extent ? extent : undefined
			  })
			});
			for (var i=0;i<ints.length;i++)
				this.map.addInteraction(ints[i]);
			this.map.addOverlay(this.popup);
			if (this.isDebug) 
				this.map.addLayer(this.debugLayerGPS);
			TRACK.init();
			this.addTrackFeature();
			//----------------------------------------------------
			this.map.on('click', function(event) 
			{
				TRACK.onMapClick(event);
				var res=[];
				var fl = this.map.forEachFeatureAtPixel(event.pixel, function(feature, layer) {
					if (layer == this.participantsLayer)
						res.push(feature);
				},this);
				if (res.length) 
				{
					var feat = this.getSelectedParticipantFromArrayCyclic(res);
					if (feat)
						this.setSelectedParticipant(feat.participant);
					else
						this.setSelectedParticipant(null);
				} else {
					this.setSelectedParticipant(null);
				}
			},this);
			//-----------------------------------------------------
			if (!this._animationInit) {
				this._animationInit=true;
				setInterval(this.onAnimation.bind(this), 1000*CONFIG.timeouts.animationFrame );
			}
        },
		
        
        addTrackFeature : function() {
        	TRACK.init();
        	if (TRACK.feature) {
        		var ft = this.trackLayer.getSource().getFeatures();
        		var ok=false;
        		for (var i=0;i<ft.length;i++) 
        		{
        			if (ft[i] == TRACK.feature)
        			{
        				ok=true;
        				break;
        			}
        		}
        		if (!ok)
        			this.trackLayer.getSource().addFeature(TRACK.feature);
        	}
        },
        zoomToTrack : function() {
            var extent = TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
            if (extent)
            	this.map.getView().fitExtent(extent,this.map.getSize());
        },
        
        getSelectedParticipantFromArrayCyclic : function(features) {
    		var arr = [];
    		var tmap = {};
    		var crrPos = 0;
			var pos=null;
    		for (var i=0;i<features.length;i++) {
    			var feature = features[i];
    			var id = feature.participant.code;
    			arr.push(id);
    			tmap[id]=true;
				if (id == this.vr_lastselected) {
					pos=i;
				}
    		}
    		var same = this.vr_oldbestarr && pos != null; 
    		if (same) 
    		{
    			// all from the old contained in the new
    			for (var i=0;i<this.vr_oldbestarr.length;i++) 
    			{
    				if (!tmap[this.vr_oldbestarr[i]]) {
    					same=false;
    					break;
    				}
    			}
    		}
    		if (!same) {
    			this.vr_oldbestarr=arr;
    			this.vr_lastselected=arr[0];
    			return features[0];
    		} else {
    			this.vr_lastselected = pos > 0 ? arr[pos-1] : arr[arr.length-1];    			
        		var resultFeature;
    			for (var i=0;i<features.length;i++) 
        		{
        			var feature = features[i];
        			var id = feature.participant.code;
        			if (id == this.vr_lastselected) {
        				resultFeature=feature;
        				break;
        			}
        		}
                return resultFeature;
    		}
        },
        
		showError : function(msg,onCloseCallback) 
		{
			alert("ERROR : "+msg);
			if (onCloseCallback) 
				onCloseCallback();
		},
		
		
		
		onAnimation : function() 
		{
			for (var ip=0;ip<TRACK.participants.length;ip++) 
			{
				var p = TRACK.participants[ip];
				p.interpolate();
			}
			if (this.selectedParticipant) 
			{
				var spos = this.selectedParticipant.getFeature().getGeometry().getCoordinates();
				if (!this.popup.is_shown) {
				    this.popup.show(spos, this.popup.lastHTML=this.selectedParticipant.getPopupHTML());
				    this.popup.is_shown=1;
				} else {
					if (!this.popup.getPosition() || this.popup.getPosition()[0] != spos[0] || this.popup.getPosition()[1] != spos[1])
					    this.popup.setPosition(spos);
					var ctime = (new Date()).getTime();			 
					if (!this.lastPopupReferesh || ctime - this.lastPopupReferesh > 2000) 
					{
						this.lastPopupReferesh=ctime;
					    var rr = this.selectedParticipant.getPopupHTML();
					    if (rr != this.popup.lastHTML) {
					    	this.popup.lastHTML=rr;
						    this.popup.content.innerHTML=rr; 
					    }					
					}
				    //this.popup.panIntoView_(spos);
				}
			}
			//--------------------			
			if (this.isDebug)  
				this.doDebugAnimation();
		},
		
		setSelectedParticipant : function(part,center) 
		{
			if (!(part instanceof Participant)) {
				var pp=part;
				part=null;
				for (var i=0;i<TRACK.participants.length;i++)
					if (TRACK.participants[i].deviceId == pp) {
						part=TRACK.participants[i];
						break;
					}
			}
			this.selectedParticipant=part;
			if (!part) {
				this.popup.hide();
				delete this.popup.is_shown;
			} else {
				if (center && GUI.map && part.feature) {
					var x = (part.feature.getGeometry().getExtent()[0]+part.feature.getGeometry().getExtent()[2])/2;
					var y = (part.feature.getGeometry().getExtent()[1]+part.feature.getGeometry().getExtent()[3])/2;
					GUI.map.getView().setCenter([x,y]);
				}
			} 
		},
		
		doDebugAnimation : function() 
		{
			var ctime = (new Date()).getTime();
			var todel=[];
			var rr = this.debugLayerGPS.getSource().getFeatures();
			for (var i=0;i<rr.length;i++)
			{
				var f = rr[i];
				if (ctime - f.timeCreated - CONFIG.math.displayDelay*1000 > CONFIG.timeouts.gpsLocationDebugShow*1000)
					todel.push(f);
				else
					f.changed();
			}
			if (todel.length) 
			{
				for (var i=0;i<todel.length;i++)
					this.debugLayerGPS.getSource().removeFeature(todel[i]);
			}
			//-------------------------------------------------------------
		},
		
		redraw : function() {
			this.getTrack().getFeature().changed();
		}
		
    }
});