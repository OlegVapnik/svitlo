package ua.com.svitlo.app.live

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import android.util.Log
import ua.com.svitlo.app.R
import ua.com.svitlo.app.widget.WidgetPayload
import ua.com.svitlo.app.widget.WidgetPrefs

/**
 * QS-плитка «Svitlo»: состояние сети одним глазом, клик открывает приложение.
 *
 * Данные — тот же snapshot виджетов из [WidgetPrefs]: JS кладёт снимок один раз, плитка,
 * виджеты и плашка читают его каждый со своей вёрсткой. Обновлений из проекта не ждём:
 * [onStartListening] читает prefs при каждом открытии шторки, а тик виджетов дергает
 * [requestUpdate] — TileService перечитает prefs.
 *
 * Строки (label/subtitle) собираются из live_strings.xml по resId из LiveStatusModel.
 */
class SvitloTileService : TileService() {

    override fun onStartListening() {
        render()
    }

    override fun onClick() {
        render()
        val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        runCatching {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                startActivityAndCollapse(
                    PendingIntent.getActivity(
                        this,
                        0,
                        launch,
                        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
                    ),
                )
            } else {
                @Suppress("DEPRECATION")
                startActivityAndCollapse(launch)
            }
        }.onFailure { Log.w(TAG, "failed to open app from tile", it) }
    }

    private fun render() {
        val tile = qsTile ?: return
        val context = applicationContext
        val payload = runCatching { WidgetPayload.parse(WidgetPrefs.readPayload(context)) }.getOrNull()

        if (payload == null) {
            tile.state = Tile.STATE_UNAVAILABLE
            tile.label = context.getString(R.string.live_tile_unavailable)
            tile.subtitle = context.getString(R.string.live_tile_prompt)
            tile.updateTile()
            return
        }

        val now = System.currentTimeMillis()
        val status = LiveStatusModel.statusOf(payload, now)
        when (LiveStatusModel.tileState(status)) {
            LiveTileState.ACTIVE -> tile.state = Tile.STATE_ACTIVE
            LiveTileState.INACTIVE -> tile.state = Tile.STATE_INACTIVE
            LiveTileState.UNAVAILABLE -> tile.state = Tile.STATE_UNAVAILABLE
        }
        tile.label = LiveStatusModel.tileLabel(status).format(context)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = LiveStatusModel.tileSubtitle(status, now)?.format(context)
                ?: context.getString(R.string.live_tile_prompt)
        }
        tile.updateTile()
    }

    companion object {
        private const val TAG = "SvitloTile"

        /**
         * Просит систему перечитать плитку: вызывается из тиков виджетов и модуля JS.
         * Без этого плитка обновляется только на открытии шторки.
         */
        fun requestUpdate(context: Context) {
            runCatching {
                TileService.requestListeningState(
                    context,
                    ComponentName(context, SvitloTileService::class.java),
                )
            }.onFailure { Log.w(TAG, "failed to request tile state", it) }
        }
    }
}
