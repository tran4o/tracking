Class("GUI", 
{
    //--------------------------------------
	// ALL COORDINATES ARE IN WORLD MERCATOR
    //--------------------------------------
    has : {
    	isDebug : {
    		init : !MOBILE
    	},
        isWidgetMode : {
            init: false
        },
		track : {
			is:   "rw"
		},
		mapElementId : {
			init : "map"
		},
        liveStreamElementId : {
            init : "liveStream"
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
			is : "ro",
			init : 'Aijt3AsWOME3hPEE_HqRlUKdcBKqe8dGRZH_v-L3H_FF64svXMbkr1T6u_WASoet'
		},
		//-------------------
		map : {
			init : null
		},
		trackLayer : {
			is : "ro",
			init : null
		},
        hotspotsLayer : {
			is : "ro",
			init : null
		},
        camsLayer : {
			is : "ro",
			init : null
		},
        participantsLayer : {
			is : "ro",
			init : null
		},
		debugLayerGPS : {
			is : "ro",
			init : null
		},	
		selectedParticipant1 : {
			is : "rw",
			init : null
		},
		selectedParticipant2 : {
			is : "rw",
			init : null
		},
		popup1 : {
			is : "rw",
			init : null
		},
		popup2 : {
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
		},
		selectNum : {
			is : "rw",
			init : 1
		},
        liveStream : {
            init: null
        }
    },
    //--------------------------------------
	methods : {
        init: function (params) {
            // create empty if not passed at all
			params = params || {};

            // when in widget mode disable debug entirely
            if (this.isWidgetMode) {
                this.isDebug = false;
            }

            var defPos = [0,0];
			if (this.initialPos)
				defPos=this.initialPos;
			//---------------------------------------------
			var extent = params.skipExtent ? null : TRACK.getRoute() && TRACK.getRoute().length > 1 ? ol.proj.transformExtent( (new ol.geom.LineString(TRACK.getRoute())).getExtent() , 'EPSG:4326', 'EPSG:3857') : null;
			this.trackLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["track"]
			});
			this.hotspotsLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["hotspot"]
			});
            this.participantsLayer = new ol.layer.Vector({
			  source: new ol.source.Vector(),
			  style : STYLES["participant"]
			});
			this.camsLayer = new ol.layer.Vector({
				source: new ol.source.Vector(),
				style : STYLES["cam"]
			});
			//--------------------------------------------------------------
			this.popup1 = new ol.Overlay.Popup({ani:false,panMapIfOutOfView : false});
			this.popup2 = new ol.Overlay.Popup({ani:false,panMapIfOutOfView : false});
			this.popup2.setOffset([0,175]);
			this.map = new ol.Map({
			  renderer : "canvas",
			  target: this.mapElementId,
			  layers: [
			           new ol.layer.Tile({
			               source: new ol.source.OSM()
			           }),
			           this.trackLayer,
			           this.hotspotsLayer,
				       this.camsLayer,
				       this.participantsLayer

			  ],
              controls:  this.isWidgetMode ? [] : ol.control.defaults(),
			  view: new ol.View({
				center: ol.proj.transform(defPos, 'EPSG:4326', 'EPSG:3857'),
				zoom: this.initialZoom,
				minZoom: this.isWidgetMode ? this.initialZoom : 10,
				maxZoom: this.isWidgetMode ? this.initialZoom : 17,
				extent : extent ? extent : undefined
			  })
			});

            //var ints = [];
			//for (var i=0;i<ints.length;i++)
			//	this.map.addInteraction(ints[i]);
			this.map.addOverlay(this.popup1);
			this.map.addOverlay(this.popup2);
			if (this.isDebug) {
                this.debugLayerGPS = new ol.layer.Vector({
                    source: new ol.source.Vector(),
                    style : STYLES["debugGPS"]
                });
                this.map.addLayer(this.debugLayerGPS);
            }
			TRACK.init();
			this.addTrackFeature();
			//----------------------------------------------------
			if (!this.isWidgetMode) {
                this.map.on('click', function (event) {
                    TRACK.onMapClick(event);
                    var selectedParticipants = [];
                    var selectedHotspot = null;
                    this.map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
                        if (layer == this.participantsLayer) {
                            selectedParticipants.push(feature);
                        } else if (layer == this.hotspotsLayer) {
                            // allow only one hotspot to be selected at a time
                            if (!selectedHotspot)
                                selectedHotspot = feature;
                        }
                    }, this);

                    // first if there are selected participants then show their popups
                    // and only if there are not use the selected hotspot if there's any
                    if (selectedParticipants.length) {
                        if (this.selectedParticipant1 == null) {
                            var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
                            if (feat)
                                this.setSelectedParticipant1(feat.participant);
                            else
                                this.setSelectedParticipant1(null);
                            this.selectNum = 0;
                        } else if (this.selectedParticipant2 == null) {
                            var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
                            if (feat)
                                this.setSelectedParticipant2(feat.participant);
                            else
                                this.setSelectedParticipant2(null);
                            this.selectNum = 1;
                        } else {
                            this.selectNum = (this.selectNum + 1) % 2;
                            if (this.selectNum == 0) {
                                var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
                                if (feat)
                                    this.setSelectedParticipant1(feat.participant);
                                else
                                    this.setSelectedParticipant1(null);
                            } else {
                                var feat = this.getSelectedParticipantFromArrayCyclic(selectedParticipants);
                                if (feat)
                                    this.setSelectedParticipant2(feat.participant);
                                else
                                    this.setSelectedParticipant2(null);
                            }
                        }
                    } else {
                        this.setSelectedParticipant1(null);
                        this.setSelectedParticipant2(null);

                        if (selectedHotspot) {
                            selectedHotspot.hotspot.onClick();
                        }
                    }
                }, this);

                // todo - RUMEN - change mouse cursor when over specific features
                //$(this.getViewport()).on('mousemove', function(e) {
                //	var pixel = map.getEventPixel(e.originalEvent);
                //	var hit = map.forEachFeatureAtPixel(pixel, function(feature, layer) {
                //		return true;
                //	});
                //	if (hit) {
                //		map.getTarget().style.cursor = 'pointer';
                //	} else {
                //		map.getTarget().style.cursor = '';
                //	}
                //});

                // pass the id of the DOM element
                this.liveStream = new LiveStream({id : this.liveStreamElementId});
            }
			//-----------------------------------------------------
			if (!this._animationInit) {
				this._animationInit=true;
				setInterval(this.onAnimation.bind(this), 1000*CONFIG.timeouts.animationFrame );
			}

			// if this is ON then it will show the coordinates position under the mouse location
            if (params.isDebugShowPosition) {
				$("#map").append('<p id="debugShowPosition">EPSG:3857 <span id="mouse3857"></span> &nbsp; EPSG:4326 <span id="mouse4326"></span>');
				this.map.on('pointermove', function(event) {
					var coord3857 = event.coordinate;
					var coord4326 = ol.proj.transform(coord3857, 'EPSG:3857', 'EPSG:4326');
					$('#mouse3857').text(ol.coordinate.toStringXY(coord3857, 2));
					$('#mouse4326').text(ol.coordinate.toStringXY(coord4326, 15));
				});
			}
        },

        addTrackFeature : function() {
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
			// first interpolate the movingCams
			for (var ic=0;ic<TRACK.movingCams.length;ic++) {
				var cam = TRACK.movingCams[ic];
				cam.interpolate();
			}

			var arr=[];
			for (var ip=0;ip<TRACK.participants.length;ip++) 
			{
				var p = TRACK.participants[ip];
				p.interpolate();
				arr.push(ip);
			}
			//-------------------------------------------------------
			arr.sort(function(a, b){
				return TRACK.participants[a].getElapsed()-TRACK.participants[b].getElapsed();
			});
			for (var ip=0;ip<TRACK.participants.length;ip++) 
			{
				TRACK.participants[arr[ip]].__pos=ip;
				if (ip == 0)
					delete TRACK.participants[arr[ip]].__prev;
				else
					TRACK.participants[arr[ip]].__prev=TRACK.participants[arr[ip-1]];
				if (ip == TRACK.participants.length-1)
					delete  TRACK.participants[arr[ip]].__next;
				else
					TRACK.participants[arr[ip]].__next=TRACK.participants[arr[ip+1]];
			}
			//-------------------------------------------------------
			if (this.selectedParticipant1) 
			{
				var spos = this.selectedParticipant1.getFeature().getGeometry().getCoordinates();
				if (!this.popup1.is_shown) {
				    this.popup1.show(spos, this.popup1.lastHTML=this.selectedParticipant1.getPopupHTML());
				    this.popup1.is_shown=1;
				} else {
					if (!this.popup1.getPosition() || this.popup1.getPosition()[0] != spos[0] || this.popup1.getPosition()[1] != spos[1])
					    this.popup1.setPosition(spos);
					var ctime = (new Date()).getTime();			 
					if (!this.lastPopupReferesh1 || ctime - this.lastPopupReferesh1 > 2000) 
					{
						this.lastPopupReferesh1=ctime;
					    var rr = this.selectedParticipant1.getPopupHTML();
					    if (rr != this.popup1.lastHTML) {
					    	this.popup1.lastHTML=rr;
						    this.popup1.content.innerHTML=rr; 
					    }					
					}
				    this.popup1.panIntoView_(spos);
				}
			}
			if (this.selectedParticipant2) 
			{
				var spos = this.selectedParticipant2.getFeature().getGeometry().getCoordinates();
				if (!this.popup2.is_shown) {
				    this.popup2.show(spos, this.popup2.lastHTML=this.selectedParticipant2.getPopupHTML());
				    this.popup2.is_shown=1;
				} else {
					if (!this.popup2.getPosition() || this.popup2.getPosition()[0] != spos[0] || this.popup2.getPosition()[1] != spos[1])
					    this.popup2.setPosition(spos);
					var ctime = (new Date()).getTime();			 
					if (!this.lastPopupReferesh2 || ctime - this.lastPopupReferesh2 > 2000) 
					{
						this.lastPopupReferesh2=ctime;
					    var rr = this.selectedParticipant2.getPopupHTML();
					    if (rr != this.popup2.lastHTML) {
					    	this.popup2.lastHTML=rr;
						    this.popup2.content.innerHTML=rr; 
					    }					
					}
				    this.popup2.panIntoView_(spos);
				}
			}
			//--------------------			
			if (this.isDebug)
				this.doDebugAnimation();
		},
		
		setSelectedParticipant1 : function(part,center) 
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
			this.selectedParticipant1=part;
			if (!part) {
				this.popup1.hide();
				delete this.popup1.is_shown;
			} else {
				this.lastPopupReferesh1=0;
				if (center && GUI.map && part.feature) {
					var x = (part.feature.getGeometry().getExtent()[0]+part.feature.getGeometry().getExtent()[2])/2;
					var y = (part.feature.getGeometry().getExtent()[1]+part.feature.getGeometry().getExtent()[3])/2;
					GUI.map.getView().setCenter([x,y]);
				}
			} 
		},

		setSelectedParticipant2 : function(part,center) 
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
			this.selectedParticipant2=part;
			if (!part) {
				this.popup2.hide();
				delete this.popup2.is_shown;
			} else {
				this.lastPopupReferesh2=0;
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
		},

        /**
         * Show the live-streaming container. If the passed 'streamId' is valid then it opens its stream directly.
         * @param {String} [streamId]
         */
        showLiveStream : function(streamId) {
            this.liveStream.show(streamId);
        },

        /**
         * Toggle the live-streaming container container
         */
        toggleLiveStream: function() {
            this.liveStream.toggle();
        }
		
    }
});