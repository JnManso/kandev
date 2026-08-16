package profileconfig

import "strings"

// SanitizeConfigOptions drops reserved identity keys (model/mode/agent) and
// blank entries so profile config options persist only auxiliary select values.
// "agent" records which agent runs the session; it is an identity field, never a
// selectable ACP config option, so it must not leak into config_options.
func SanitizeConfigOptions(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for key, value := range in {
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if key == "" || value == "" || key == "model" || key == "mode" || key == "agent" {
			continue
		}
		out[key] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}
