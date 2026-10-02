// DATA is embedded by package_plan.cjs. Run this as a Figma Design development plugin.
(async () => {
  let frame;
  try {
    const available = await figma.listAvailableFontsAsync();
    function choose(families) {
      for (const family of families) {
        const font = available.find(f => f.fontName.family === family && /^(Regular|Normal|Book)$/.test(f.fontName.style));
        if (font) return font.fontName;
      }
      throw new Error('Install one of these fonts: ' + families.join(', '));
    }
    const latin = choose(['Inter', 'Arial']);
    const chinese = choose(['Noto Sans SC', 'Noto Sans CJK SC', 'Microsoft YaHei', 'PingFang SC']);
    await figma.loadFontAsync(latin);
    await figma.loadFontAsync(chinese);
    function paint(hex) {
      if (!hex || hex === 'none') return [];
      const n = parseInt(hex.slice(1),16);
      return [{type:'SOLID',color:{r:((n>>16)&255)/255,g:((n>>8)&255)/255,b:(n&255)/255}}];
    }
    frame = figma.createFrame();
    frame.name = 'Robot coffee bar / 2 px per cm';
    frame.resize(DATA.width, DATA.height);
    frame.fills = [];
    frame.clipsContent = false;
    frame.setPluginData('pixelsPerCentimetre','2');
    frame.setPluginData('source','Supplied architectural screenshot');
    frame.setPluginData('parameters',JSON.stringify(DATA.parameters));
    function buildGroup(layer) {
      const members = [];
      for (const o of layer.shapes) {
        let n;
        if (o.kind === 'line') {
          n = figma.createLine();
          frame.appendChild(n);
          const dx=o.x2-o.x1, dy=o.y2-o.y1, length=Math.hypot(dx,dy), a=Math.atan2(dy,dx);
          n.resize(length,0);
          n.relativeTransform = [[Math.cos(a),-Math.sin(a),o.x1],[Math.sin(a),Math.cos(a),o.y1]];
        } else {
          n = o.kind === 'ellipse' ? figma.createEllipse() : figma.createRectangle();
          frame.appendChild(n);
          n.resize(o.width,o.height);
          n.x=o.x; n.y=o.y;
          if (o.kind === 'rect') n.cornerRadius=o.radius || 0;
          n.fills=paint(o.fill);
        }
        n.name=o.name;
        n.strokes=paint(o.stroke);
        n.strokeWeight=o.stroke_width || 0;
        n.strokeAlign='CENTER';
        n.dashPattern=o.dash || [];
        n.opacity=o.opacity === undefined ? 1 : o.opacity;
        if (o.physical_cm) n.setPluginData('physicalCentimetres',JSON.stringify(o.physical_cm));
        if (o.range_type) n.setPluginData('rangeType',o.range_type);
        members.push(n);
      }
      for (const o of layer.texts) {
        const n=figma.createText();
        frame.appendChild(n);
        n.name=o.name;
        n.fontName=latin;
        n.fontSize=o.font_size;
        n.characters=o.text;
        for (let i=0;i<o.text.length;i++) if (/[\u2e80-\u9fff\u3000-\u303f\uff00-\uffef]/.test(o.text[i])) n.setRangeFontName(i,i+1,chinese);
        n.textAutoResize='WIDTH_AND_HEIGHT';
        n.lineHeight={unit:'PIXELS',value:o.height};
        n.fills=paint(o.color);
        const dx=o.align==='center' ? -n.width/2 : o.align==='right' ? -n.width : 0;
        const dy=-o.ascent, a=o.rotation*Math.PI/180, co=Math.cos(a), si=Math.sin(a);
        n.relativeTransform=[[co,-si,o.x+co*dx-si*dy],[si,co,o.y+si*dx+co*dy]];
        members.push(n);
      }
      for (const child of layer.children || []) { const childGroup=buildGroup(child); if(childGroup) members.push(childGroup); }
      if (members.length) {
        const g=figma.group(members,frame);
        g.name=layer.name;
        if (layer.name==='Background') g.locked=true;
        if (layer.role) g.setPluginData('role', layer.role);
        if (layer.robot) g.setPluginData('robot', layer.robot);
        return g;
      }
    }
    for (const layer of DATA.layers) buildGroup(layer);
    frame.x=Math.round(figma.viewport.center.x-DATA.width/2);
    frame.y=Math.round(figma.viewport.center.y-DATA.height/2);
    figma.currentPage.selection=[frame];
    figma.viewport.scrollAndZoomIntoView([frame]);
    figma.closePlugin('Imported '+DATA.layers.length+' area groups at 2 px/cm, with nested robot packages and editable labels.');
  } catch (error) {
    if (frame && !frame.removed) frame.remove();
    figma.closePlugin('Import failed: '+(error.message || String(error)));
  }
})();
