#pragma once
#include "cdp.hpp"

namespace dsh {
Json discoverRuntime(Cdp& client, const Host& host, const Assets& assets, bool force);
Json control(Cdp& client, const Assets& assets, const std::string& action, Json fields = Json::object());
}
