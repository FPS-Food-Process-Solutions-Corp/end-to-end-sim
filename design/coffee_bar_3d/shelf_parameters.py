"""Physical shelf limits shared in behaviour with editor/shelf-parameters.js."""
import math

DEFAULTS = dict(tiers=4, tier_spacing=.4, first_tier_front_height=.35,
                back_to_front_drop=.1, columns=6, post_width=.025,
                sheet_thickness=.002, divider_height=.06, front_lip_height=.025,
                show_buns=True, bread_length_1=.102, bread_length_2=.094,
                bread_height=.062, bread_gap=.015)


def shelf_layout(scene, obj):
    s = DEFAULTS | scene.get('shelves', {}) | obj.get('shelf_overrides', {})
    def number(value, fallback, lower, upper):
        try:
            value = float(value)
            return max(lower, min(upper, value)) if math.isfinite(value) else fallback
        except (ValueError, TypeError):
            return fallback
    h = max(.01, obj.get('height', 1.8))
    s['columns'] = math.floor(number(s['columns'], 6, 1, 24) + .5)
    for key in ('bread_length_1', 'bread_length_2'):
        s[key] = number(s[key], DEFAULTS[key], .01, 1)
    s['bread_height'] = number(s['bread_height'], .062, .005, .5)
    s['bread_gap'] = number(s['bread_gap'], .015, 0, .1)
    tray_w = max(.01, obj['width'] - 2*s['post_width'] - .004)
    tray_d = max(.01, obj['depth'] - 2*s['post_width'])
    s['back_to_front_drop'] = number(s['back_to_front_drop'], .1, 0, max(0, h-.08))
    drop, sheet = s['back_to_front_drop'], s['sheet_thickness']
    slope, surface_depth = math.atan2(drop, tray_d), math.hypot(tray_d, drop)
    cos, sin = math.cos(slope), math.sin(slope)
    rows = max(1, min(24, math.floor((surface_depth-.02+s['bread_gap'])/(s['bread_length_2']+s['bread_gap']))))
    structure_envelope = drop+(s['divider_height']+sheet)*cos+sheet/2*sin
    bread_envelope = sheet*cos+drop/2+(rows-1)/2*(s['bread_length_2']+s['bread_gap'])*sin+s['bread_height']/2*cos+math.hypot(s['bread_length_2']/2*sin,s['bread_height']/2*cos)
    envelope = max(structure_envelope, bread_envelope if s['show_buns'] else 0)
    minimum_spacing = (sheet+max(s['divider_height'],s['bread_height'] if s['show_buns'] else 0))/cos+.005
    s['first_tier_front_height'] = number(s['first_tier_front_height'], .35, 0, max(0,h-envelope))
    s['tier_spacing'] = number(s['tier_spacing'], .4, minimum_spacing, max(h,minimum_spacing))
    maximum = 0 if envelope>h+1e-9 else max(1,math.floor((h-s['first_tier_front_height']-envelope+1e-9)/s['tier_spacing'])+1)
    s['tiers'] = math.floor(number(s['tiers'],min(4,maximum),1,maximum)+.5) if maximum else 0
    return dict(settings=s, tray_width=tray_w, tray_depth=tray_d, surface_depth=surface_depth,
                slope=slope, rows=rows, max_tiers=maximum, min_spacing=minimum_spacing,
                tier_envelope=envelope, clear_column_width=max(0,tray_w/s['columns']-sheet),
                clear_vertical_gap=max(0,s['tier_spacing']-sheet/cos))
